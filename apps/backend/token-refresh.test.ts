import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { randomBytes } from "node:crypto";
import { getFunctionName } from "convex/server";
import { loadModule } from "./test-utils/load-module.ts";
import { testDatabase } from "./test-utils/database.ts";

const refresh = await loadModule("../convex/publishing/tokenRefresh.ts");
const publishing = await loadModule("../convex/publishing.ts");
const actions = await loadModule("../convex/publishing/actions.ts");
const cryptoModule = await loadModule("../convex/oauth/crypto.ts");
const keys = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "X_CLIENT_ID",
  "X_CLIENT_SECRET",
  "META_APP_ID",
  "META_APP_SECRET",
  "TOKEN_ENCRYPTION_KEY",
];

function setup(t: TestContext) {
  const originalFetch = globalThis.fetch;
  const env = keys.map((key) => [key, process.env[key]] as const);
  for (const key of keys) process.env[key] = "dummy-credential-only";
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of env) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

for (const [platform, required] of [
  ["youtube", "GOOGLE_CLIENT_ID"],
  ["x", "X_CLIENT_ID"],
  ["instagram", "META_APP_ID"],
] as const) {
  test(`${platform} missing configuration fails before exposing a refresh token`, async (t) => {
    setup(t);
    delete process.env[required];
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      throw new Error("Unexpected external request");
    };
    await assert.rejects(
      refresh.refreshAccessTokenForPlatform(
        { platform, providerAccountId: "qa-provider" },
        "dummy-refresh",
      ),
      /Convex is missing/,
    );
    assert.equal(calls, 0);
  });
}

for (const [status, error] of [
  [400, "invalid_grant"],
  [429, "rate_limited"],
  [500, "server_error"],
] as const) {
  test(`HTTP ${status} ${error} is classified without mistaking temporary failure for revocation`, async (t) => {
    setup(t);
    globalThis.fetch = async () => Response.json({ error }, { status });
    if (status === 400) {
      await assert.rejects(
        refresh.refreshAccessTokenForPlatform(
          { platform: "x" },
          "dummy-refresh",
        ),
        (failure: unknown) => refresh.isTokenRefreshRejected(failure),
      );
    } else {
      assert.equal(
        await refresh.refreshAccessTokenForPlatform(
          { platform: "x" },
          "dummy-refresh",
        ),
        null,
      );
    }
  });
}

test("network timeout is not definitive grant rejection", async (t) => {
  setup(t);
  globalThis.fetch = async () => {
    throw new Error("fixture timeout");
  };
  await assert.rejects(
    refresh.refreshAccessTokenForPlatform({ platform: "x" }, "dummy-refresh"),
    (failure: unknown) =>
      failure instanceof Error && !refresh.isTokenRefreshRejected(failure),
  );
});

for (const replacement of [undefined, "rotated-refresh"]) {
  test(`X renewal ${replacement ? "rotates" : "preserves"} its refresh token`, async (t) => {
    setup(t);
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://api.x.com/2/oauth2/token");
      assert.equal(init?.method, "POST");
      assert.equal(
        new URLSearchParams(String(init?.body)).get("refresh_token"),
        "dummy-refresh",
      );
      return Response.json({
        access_token: "fresh-dummy-access",
        expires_in: 3600,
        ...(replacement ? { refresh_token: replacement } : {}),
      });
    };
    const result = await refresh.refreshAccessTokenForPlatform(
      { platform: "x" },
      "dummy-refresh",
    );
    assert.equal(result.accessToken, "fresh-dummy-access");
    assert.equal(result.refreshToken, replacement ?? "dummy-refresh");
    assert.ok(result.expiresAt > Date.now() + 3500000);
  });
}

test("refresh persistence encrypts credentials and retains an omitted refresh token", async (t) => {
  setup(t);
  const oldRefresh = await cryptoModule.encryptSecret("old-dummy-refresh");
  const fixture = testDatabase({
    connectedAccounts: [
      {
        _id: "account-1",
        status: "active",
        encryptedRefreshToken: oldRefresh,
        tokenExpiresAt: 1,
        refreshTokenExpiresAt: 6000,
      },
    ],
  });
  const expiry = Date.now() + 3600000;
  const result = await publishing.applyRefreshedToken._handler(fixture.ctx, {
    accountId: "account-1",
    accessToken: "fresh-dummy-access",
    expiresAt: expiry,
  });
  assert.equal(result.status, "active");
  assert.equal(result.tokenExpiresAt, expiry);
  assert.notEqual(result.encryptedAccessToken, "fresh-dummy-access");
  assert.equal(
    await cryptoModule.decryptSecret(result.encryptedAccessToken),
    "fresh-dummy-access",
  );
  assert.equal(result.encryptedRefreshToken, oldRefresh);
  assert.equal(result.refreshTokenExpiresAt, 6000);
});

for (const failure of [
  "configuration",
  "network",
  "500",
  "429",
  "invalid_grant",
]) {
  test(`publish refresh ${failure} retains the account unless grant is definitively rejected`, async (t) => {
    setup(t);
    if (failure === "configuration") delete process.env.X_CLIENT_ID;
    globalThis.fetch = async () => {
      if (failure === "configuration")
        assert.fail("must not call provider without credentials");
      if (failure === "network") throw new Error("fixture network unavailable");
      return Response.json(
        {
          error:
            failure === "invalid_grant" ? "invalid_grant" : "temporary_error",
        },
        { status: failure === "invalid_grant" ? 400 : Number(failure) },
      );
    };
    const fixture = testDatabase({
      posts: [
        {
          _id: "post-1",
          teamId: "team-1",
          status: "publishing",
          body: "QA",
          kind: "text",
        },
      ],
      postTargets: [
        {
          _id: "target-1",
          teamId: "team-1",
          postId: "post-1",
          connectedAccountId: "account-1",
          platform: "x",
          status: "scheduled",
          attempts: 0,
          updatedAt: 1,
        },
      ],
      connectedAccounts: [
        {
          _id: "account-1",
          teamId: "team-1",
          platform: "x",
          providerAccountId: "qa-provider",
          status: "active",
          scopes: ["tweet.write", "media.write"],
          encryptedAccessToken: await cryptoModule.encryptSecret("old-access"),
          encryptedRefreshToken:
            await cryptoModule.encryptSecret("old-refresh"),
          tokenExpiresAt: 1,
        },
      ],
    });
    const ctx = {
      runQuery: async (reference: any, args: any) => {
        const name = getFunctionName(reference).split(":")[1]!;
        if (!publishing[name]) throw new Error(`Unexpected query ${name}`);
        return publishing[name]._handler(fixture.ctx, args);
      },
      runMutation: async (reference: any, args: any) => {
        const name = getFunctionName(reference).split(":")[1]!;
        if (!publishing[name]) throw new Error(`Unexpected mutation ${name}`);
        return publishing[name]._handler(fixture.ctx, args);
      },
    };
    await actions.publishOneTarget._handler(ctx, {
      postId: "post-1",
      targetId: "target-1",
    });
    assert.equal(
      fixture.tables.connectedAccounts![0]!.status,
      failure === "invalid_grant" ? "expired" : "active",
    );
    assert.equal(fixture.tables.postTargets![0]!.status, "failed");
    assert.equal(
      fixture.tables.postTargets![0]!.failureCode,
      failure === "invalid_grant" ? "no_token" : "token_refresh_failed",
    );
    assert.deepEqual(fixture.jobs, []);
  });
}

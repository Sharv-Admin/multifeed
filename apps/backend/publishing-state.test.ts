import assert from "node:assert/strict";
import test from "node:test";
import { loadModule } from "./test-utils/load-module.ts";
import { testDatabase } from "./test-utils/database.ts";

const publishing = await loadModule("../convex/publishing.ts");
const posts = await loadModule("../convex/posts.ts");
const post = {
  _id: "post-1",
  teamId: "team-1",
  status: "scheduled",
  scheduledFor: 1,
  createdAt: 1,
  updatedAt: 1,
};
const target = {
  _id: "target-1",
  postId: "post-1",
  teamId: "team-1",
  platform: "x",
  connectedAccountId: "account-1",
  status: "skipped",
  attempts: 1,
  createdAt: 1,
  updatedAt: 1,
  failureCode: "account_disconnected",
};

test("all-skipped post fails without scheduling provider jobs or changing targets", async () => {
  const fixture = testDatabase({ posts: [post], postTargets: [target] });
  await publishing.publishPost._handler(fixture.ctx, { postId: "post-1" });
  assert.equal(fixture.tables.posts![0]!.status, "failed");
  assert.deepEqual(fixture.jobs, []);
  assert.deepEqual(fixture.tables.postTargets, [target]);
});

for (const [statuses, expected] of [
  [[], "failed"],
  [["failed"], "failed"],
  [["published", "skipped"], "published"],
  [["published", "failed"], "published"],
  [["published", "scheduled"], "publishing"],
  [["publishing", "skipped"], "publishing"],
  [["draft", "failed"], "publishing"],
] as const) {
  test(`reconciliation of ${statuses.join("+") || "zero targets"} returns ${expected}`, async () => {
    const fixture = testDatabase({
      posts: [{ ...post, status: "publishing" }],
      postTargets: statuses.map((status, i) => ({
        ...target,
        _id: `target-${i}`,
        status,
      })),
    });
    await publishing.reconcilePostStatus._handler(fixture.ctx, {
      postId: "post-1",
    });
    assert.equal(fixture.tables.posts![0]!.status, expected);
    assert.deepEqual(fixture.jobs, []);
  });
}

test("duplicate claim stays busy and does not increment attempts twice", async () => {
  const fixture = testDatabase({
    posts: [{ ...post, status: "publishing" }],
    postTargets: [{ ...target, status: "scheduled", attempts: 0 }],
  });
  assert.equal(
    await publishing.claimTargetForPublish._handler(fixture.ctx, {
      targetId: "target-1",
    }),
    "claimed",
  );
  assert.equal(
    await publishing.claimTargetForPublish._handler(fixture.ctx, {
      targetId: "target-1",
    }),
    "busy",
  );
  assert.equal(fixture.tables.postTargets![0]!.attempts, 1);
});

test("known provider checkpoint resumes while unknown stale outcome fails safely", async () => {
  const checkpoint = { platformPostId: "provider-post-1" };
  const known = testDatabase({
    posts: [{ ...post, status: "publishing" }],
    postTargets: [
      { ...target, status: "publishing", publishAttempt: checkpoint },
    ],
  });
  assert.equal(
    await publishing.claimTargetForPublish._handler(known.ctx, {
      targetId: "target-1",
    }),
    "resume",
  );
  assert.deepEqual(known.tables.postTargets![0]!.publishAttempt, checkpoint);
  const unknown = testDatabase({
    posts: [{ ...post, status: "publishing" }],
    postTargets: [{ ...target, status: "publishing" }],
  });
  assert.equal(
    await publishing.claimTargetForPublish._handler(unknown.ctx, {
      targetId: "target-1",
    }),
    "done",
  );
  assert.equal(unknown.tables.postTargets![0]!.status, "failed");
  assert.equal(unknown.tables.postTargets![0]!.failureCode, "stale_publish");
  assert.deepEqual(unknown.jobs, []);
});

test("old draft jobs and future schedules never fan out", async () => {
  for (const candidate of [
    { ...post, status: "draft" },
    { ...post, scheduledFor: Date.now() + 3600000 },
  ]) {
    const fixture = testDatabase({
      posts: [candidate],
      postTargets: [{ ...target, status: "scheduled" }],
    });
    await publishing.publishPost._handler(fixture.ctx, { postId: "post-1" });
    assert.equal(fixture.tables.posts![0]!.status, candidate.status);
    assert.deepEqual(fixture.jobs, []);
  }
});

test("retry schedules failed targets only and preserves provider checkpoints", async () => {
  const prior = process.env.NEXT_PUBLIC_HEXCLAVE_PROJECT_ID;
  process.env.NEXT_PUBLIC_HEXCLAVE_PROJECT_ID = "qa-project";
  try {
    const checkpoint = { platformPostId: "provider-post-1" };
    const fixture = testDatabase({
      posts: [{ ...post, status: "failed" }],
      postTargets: [
        { ...target, status: "failed", publishAttempt: checkpoint },
        { ...target, _id: "already-published", status: "published" },
        { ...target, _id: "skipped-target", status: "skipped" },
      ],
    });
    const ctx = {
      ...fixture.ctx,
      auth: {
        getUserIdentity: async () => ({
          subject: "user-1",
          tokenIdentifier: "qa-token",
          role: "authenticated",
          project_id: "qa-project",
          selected_team_id: "team-1",
          is_anonymous: false,
          is_restricted: false,
        }),
      },
    };
    assert.deepEqual(
      await posts.retryFailed._handler(ctx, { postId: "post-1" }),
      { retried: 1 },
    );
    assert.deepEqual(
      fixture.tables.postTargets!.map((row) => row.status),
      ["scheduled", "published", "skipped"],
    );
    assert.deepEqual(
      fixture.tables.postTargets![0]!.publishAttempt,
      checkpoint,
    );
    assert.equal(fixture.tables.posts![0]!.status, "scheduled");
    assert.equal(fixture.jobs.length, 1);
  } finally {
    if (prior === undefined) delete process.env.NEXT_PUBLIC_HEXCLAVE_PROJECT_ID;
    else process.env.NEXT_PUBLIC_HEXCLAVE_PROJECT_ID = prior;
  }
});

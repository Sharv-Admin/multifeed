"use node";

import type { Doc } from "../_generated/dataModel";
import { META_GRAPH } from "./apiVersions";
import { decryptSecret } from "../oauth/crypto";

export type RefreshedToken = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  refreshTokenExpiresAt?: number;
};

/**
 * Thrown when the provider definitively rejects a refresh grant (e.g.
 * invalid_grant, revoked token). Transient failures must not mark the
 * connected account expired, so callers distinguish this from other errors.
 */
export class TokenRefreshRejectedError extends Error {
  readonly rejected = true;
  constructor(message: string) {
    super(message);
    this.name = "TokenRefreshRejectedError";
  }
}

export function isTokenRefreshRejected(error: unknown) {
  return (
    error instanceof TokenRefreshRejectedError ||
    (error instanceof Error &&
      "rejected" in error &&
      (error as { rejected?: unknown }).rejected === true)
  );
}

const DEFINITIVE_GRANT_ERRORS = [
  "invalid_grant",
  "invalid_token",
  "unauthorized_client",
];

function errorCode(json: Record<string, unknown>): string | number | undefined {
  const err = json.error;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    if (typeof e.code === "string" || typeof e.code === "number") {
      return e.code;
    }
    if (typeof e.type === "string") return e.type;
  }
  return undefined;
}

function errorText(json: Record<string, unknown>): string {
  const parts: string[] = [];
  const err = json.error;
  if (typeof err === "string") parts.push(err);
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    for (const key of ["code", "type", "error_subcode", "message"]) {
      if (e[key] != null) parts.push(String(e[key]));
    }
  }
  for (const key of ["error_description", "error_message", "message"]) {
    if (typeof json[key] === "string") parts.push(json[key] as string);
  }
  return parts.join(" ").toLowerCase();
}

/** True when the provider's response means the grant is dead for good. */
function isDefinitiveRejection(json: Record<string, unknown>): boolean {
  const code = errorCode(json);
  if (
    typeof code === "string" &&
    DEFINITIVE_GRANT_ERRORS.includes(code.toLowerCase())
  ) {
    return true;
  }
  // Meta uses error code 190 / OAuthException for invalid or expired tokens.
  if (code === 190 || code === "OAuthException") return true;
  return DEFINITIVE_GRANT_ERRORS.some((pattern) =>
    errorText(json).includes(pattern),
  );
}

function rejectionMessage(
  json: Record<string, unknown>,
  fallback: string,
): string {
  const err = json.error;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    if (typeof e.message === "string") return e.message;
  }
  if (typeof json.error_description === "string") return json.error_description;
  return fallback;
}

function throwIfRejected(
  json: Record<string, unknown>,
  fallback: string,
): void {
  if (isDefinitiveRejection(json)) {
    throw new TokenRefreshRejectedError(rejectionMessage(json, fallback));
  }
}

async function fetchJson(url: string, init: RequestInit = {}) {
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, json };
}

async function inspectFacebookPageToken(accessToken: string) {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error("Convex is missing META_APP_ID or META_APP_SECRET");
  }
  const params = new URLSearchParams({ input_token: accessToken });
  const { ok, json } = await fetchJson(`${META_GRAPH}/debug_token?${params}`, {
    headers: { Authorization: `Bearer ${appId}|${appSecret}` },
  });
  if (!ok) throw new Error("Facebook Page token inspection failed");
  const data = json.data as
    | { is_valid?: boolean; expires_at?: number }
    | undefined;
  if (!data?.is_valid) return null;
  return {
    accessToken,
    expiresAt: data.expires_at ? data.expires_at * 1000 : undefined,
  };
}

async function refreshMetaPageToken(
  platform: "facebook" | "instagram",
  userToken: string,
  providerAccountId: string,
): Promise<RefreshedToken | null> {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret)
    throw new Error("Convex is missing META_APP_ID or META_APP_SECRET");

  const exchanged = await fetchJson(
    `${META_GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${encodeURIComponent(appId)}&client_secret=${encodeURIComponent(appSecret)}&fb_exchange_token=${encodeURIComponent(userToken)}`,
  );
  if (!exchanged.ok) {
    throwIfRejected(exchanged.json, "Meta rejected this account's token");
  }
  const nextUserToken =
    exchanged.ok && typeof exchanged.json.access_token === "string"
      ? exchanged.json.access_token
      : userToken;
  const expiresAt =
    exchanged.ok && typeof exchanged.json.expires_in === "number"
      ? Date.now() + exchanged.json.expires_in * 1000
      : undefined;

  if (platform === "facebook") {
    // Fetch the selected Page directly, including Pages beyond /me/accounts' first page.
    const page = await fetchJson(
      `${META_GRAPH}/${providerAccountId}?fields=access_token`,
      {
        headers: { Authorization: `Bearer ${nextUserToken}` },
      },
    );
    if (!page.ok) {
      throwIfRejected(page.json, "Meta rejected this account's token");
      return null;
    }
    if (typeof page.json.access_token !== "string") return null;
    const inspected = await inspectFacebookPageToken(page.json.access_token);
    if (!inspected) return null;
    return {
      ...inspected,
      refreshToken: nextUserToken,
      refreshTokenExpiresAt: expiresAt,
    };
  }

  const pages = await fetchJson(
    `${META_GRAPH}/me/accounts?fields=id,access_token,instagram_business_account&limit=100&access_token=${encodeURIComponent(nextUserToken)}`,
  );
  if (!pages.ok) {
    throwIfRejected(pages.json, "Meta rejected this account's token");
    return null;
  }
  if (!Array.isArray(pages.json.data)) return null;

  const page = (pages.json.data as Array<Record<string, unknown>>).find(
    (entry) => {
      const ig = entry.instagram_business_account as
        | { id?: string }
        | undefined;
      return ig?.id === providerAccountId;
    },
  );
  const pageToken =
    page && typeof page.access_token === "string" ? page.access_token : null;
  if (!pageToken) return null;

  return {
    accessToken: pageToken,
    refreshToken: nextUserToken,
    expiresAt,
    refreshTokenExpiresAt: expiresAt,
  };
}

export async function refreshAccessTokenForPlatform(
  account: Doc<"connectedAccounts">,
  refreshToken: string,
): Promise<RefreshedToken | null> {
  if (account.platform === "facebook" && account.encryptedAccessToken) {
    // Older connections incorrectly inherited the user token's expiration.
    // Keep a valid Page token even when its backing user token has expired.
    const accessToken = await decryptSecret(account.encryptedAccessToken);
    const inspected = await inspectFacebookPageToken(accessToken);
    if (inspected) return inspected;
  }

  if (account.platform === "x") {
    const id = process.env.X_CLIENT_ID;
    const secret = process.env.X_CLIENT_SECRET;
    if (!id) throw new Error("Convex is missing X_CLIENT_ID");
    const body = new URLSearchParams({
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    });
    if (!secret) body.set("client_id", id);
    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
    };
    if (secret) headers.Authorization = `Basic ${btoa(`${id}:${secret}`)}`;
    const { ok, json } = await fetchJson("https://api.x.com/2/oauth2/token", {
      method: "POST",
      headers,
      body,
    });
    if (!ok) throwIfRejected(json, "X rejected this account's token");
    if (typeof json.access_token !== "string") return null;
    return {
      accessToken: json.access_token,
      refreshToken:
        typeof json.refresh_token === "string"
          ? json.refresh_token
          : refreshToken,
      expiresAt:
        typeof json.expires_in === "number"
          ? Date.now() + json.expires_in * 1000
          : undefined,
    };
  }

  if (account.platform === "linkedin") {
    const id = process.env.LINKEDIN_CLIENT_ID;
    const secret = process.env.LINKEDIN_CLIENT_SECRET;
    if (!id || !secret)
      throw new Error(
        "Convex is missing LINKEDIN_CLIENT_ID or LINKEDIN_CLIENT_SECRET",
      );
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: id,
      client_secret: secret,
    });
    const { ok, json } = await fetchJson(
      "https://www.linkedin.com/oauth/v2/accessToken",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      },
    );
    if (!ok) throwIfRejected(json, "LinkedIn rejected this account's token");
    if (typeof json.access_token !== "string") return null;
    return {
      accessToken: json.access_token,
      refreshToken:
        typeof json.refresh_token === "string"
          ? json.refresh_token
          : refreshToken,
      expiresAt:
        typeof json.expires_in === "number"
          ? Date.now() + json.expires_in * 1000
          : undefined,
      refreshTokenExpiresAt:
        typeof json.refresh_token_expires_in === "number"
          ? Date.now() + json.refresh_token_expires_in * 1000
          : undefined,
    };
  }

  if (account.platform === "youtube") {
    const id = process.env.GOOGLE_CLIENT_ID;
    const secret = process.env.GOOGLE_CLIENT_SECRET;
    if (!id || !secret)
      throw new Error(
        "Convex is missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET",
      );
    const body = new URLSearchParams({
      client_id: id,
      client_secret: secret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    });
    const { ok, json } = await fetchJson(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      },
    );
    if (!ok) throwIfRejected(json, "Google rejected this account's token");
    if (typeof json.access_token !== "string") return null;
    return {
      accessToken: json.access_token,
      refreshToken,
      expiresAt:
        typeof json.expires_in === "number"
          ? Date.now() + json.expires_in * 1000
          : undefined,
    };
  }

  if (account.platform === "tiktok") {
    const key = process.env.TIKTOK_CLIENT_KEY;
    const secret = process.env.TIKTOK_CLIENT_SECRET;
    if (!key || !secret)
      throw new Error(
        "Convex is missing TIKTOK_CLIENT_KEY or TIKTOK_CLIENT_SECRET",
      );
    const body = new URLSearchParams({
      client_key: key,
      client_secret: secret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
    const { ok, json } = await fetchJson(
      "https://open.tiktokapis.com/v2/oauth/token/",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      },
    );
    if (!ok) throwIfRejected(json, "TikTok rejected this account's token");
    if (typeof json.access_token !== "string") return null;
    return {
      accessToken: json.access_token,
      refreshToken:
        typeof json.refresh_token === "string"
          ? json.refresh_token
          : refreshToken,
      expiresAt:
        typeof json.expires_in === "number"
          ? Date.now() + json.expires_in * 1000
          : undefined,
      refreshTokenExpiresAt:
        typeof json.refresh_expires_in === "number"
          ? Date.now() + json.refresh_expires_in * 1000
          : undefined,
    };
  }

  if (account.platform === "threads") {
    const { ok, json } = await fetchJson(
      `https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(refreshToken)}`,
    );
    if (!ok) throwIfRejected(json, "Threads rejected this account's token");
    if (typeof json.access_token !== "string") return null;
    const expiresAt =
      typeof json.expires_in === "number"
        ? Date.now() + json.expires_in * 1000
        : undefined;
    return {
      accessToken: json.access_token,
      refreshToken: json.access_token,
      expiresAt,
      refreshTokenExpiresAt: expiresAt,
    };
  }

  if (account.platform === "facebook" || account.platform === "instagram") {
    return refreshMetaPageToken(
      account.platform,
      refreshToken,
      account.providerAccountId,
    );
  }

  return null;
}

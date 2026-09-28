import { requireEnv } from "../env";
import { oauthFetch } from "./http";
import type { SocialConnector, TokenBundle } from "./types";

const SCOPES = ["user.info.basic", "user.info.profile", "video.publish"];
const TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";

const credentials = () => ({
  clientKey: requireEnv("TIKTOK_CLIENT_KEY"),
  clientSecret: requireEnv("TIKTOK_CLIENT_SECRET"),
});

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_expires_in?: number;
  scope?: string;
  open_id?: string;
  error?: string;
  error_description?: string;
};

const tokenBundle = (data: TokenResponse, fallbackRefreshToken?: string) => ({
  accessToken: data.access_token!,
  refreshToken: data.refresh_token ?? fallbackRefreshToken,
  expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
  refreshTokenExpiresAt: data.refresh_expires_in
    ? Date.now() + data.refresh_expires_in * 1000
    : undefined,
  scopes: data.scope?.split(",").filter(Boolean) ?? SCOPES,
  tokenType: "user" as const,
});

export const tiktokConnector: SocialConnector = {
  platform: "tiktok",
  capabilities: ["image", "video", "carousel"],
  requiresPkce: false,

  buildAuthorizeUrl(input) {
    const { clientKey } = credentials();
    const params = new URLSearchParams({
      client_key: clientKey,
      response_type: "code",
      scope: SCOPES.join(","),
      redirect_uri: input.redirectUri,
      state: input.state,
    });
    return `https://www.tiktok.com/v2/auth/authorize/?${params}`;
  },

  async exchangeCode(input) {
    const { clientKey, clientSecret } = credentials();
    const res = await oauthFetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        code: input.code,
        grant_type: "authorization_code",
        redirect_uri: input.redirectUri,
      }),
    });
    const data = (await res.json()) as TokenResponse;
    if (!res.ok || !data.access_token) {
      throw new Error(
        data.error_description ?? data.error ?? "TikTok token exchange failed",
      );
    }
    return tokenBundle(data) satisfies TokenBundle;
  },

  async fetchProfile(accessToken) {
    const fields = [
      "open_id",
      "union_id",
      "avatar_url",
      "display_name",
      "username",
    ].join(",");
    const res = await oauthFetch(
      `https://open.tiktokapis.com/v2/user/info/?fields=${fields}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const data = (await res.json()) as {
      data?: {
        user?: {
          open_id?: string;
          union_id?: string;
          avatar_url?: string;
          display_name?: string;
          username?: string;
        };
      };
      error?: { code?: string; message?: string };
    };
    const user = data.data?.user;
    if (!res.ok || data.error?.code !== "ok" || !user?.open_id) {
      throw new Error(data.error?.message ?? "TikTok profile fetch failed");
    }
    return {
      providerAccountId: user.open_id,
      username: user.username ?? user.display_name ?? user.open_id,
      displayName: user.display_name,
      avatarUrl: user.avatar_url,
      tokenType: "user" as const,
      metadata: user.union_id ? { unionId: user.union_id } : undefined,
    };
  },
};

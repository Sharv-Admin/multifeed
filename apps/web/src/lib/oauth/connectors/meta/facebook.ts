import { requireEnv } from "../../env";
import type { AccountProfile, SocialConnector, TokenBundle } from "../types";
import {
  metaAuthorizeUrl,
  metaExchangeCode,
  metaListPages,
  metaPageTokenExpiresAt,
  pagesToFacebookOptions,
} from "./shared";

const SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "pages_manage_engagement",
  "pages_read_user_content",
  "read_insights",
  "pages_manage_metadata",
];

export const facebookConnector: SocialConnector = {
  platform: "facebook",
  capabilities: ["text", "image", "video", "carousel", "analytics"],
  requiresPkce: false,

  buildAuthorizeUrl(input) {
    return metaAuthorizeUrl({
      ...input,
      configurationId: requireEnv("META_FACEBOOK_CONFIG_ID"),
    });
  },

  async exchangeCode(input) {
    const tokens = await metaExchangeCode(input);
    const missing = SCOPES.filter((scope) => !tokens.scopes.includes(scope));
    if (missing.length) {
      throw new Error(`Missing Facebook permissions: ${missing.join(", ")}`);
    }
    return tokens;
  },

  async listAccounts(accessToken) {
    const pages = await metaListPages(accessToken);
    return pagesToFacebookOptions(pages);
  },

  async resolveAccount(userTokens, option) {
    const pageAccessToken = option.metadata?.pageAccessToken;
    if (typeof pageAccessToken !== "string") {
      throw new Error("Facebook Page access token not available");
    }

    const tokens: TokenBundle = {
      accessToken: pageAccessToken,
      refreshToken: userTokens.accessToken,
      expiresAt: await metaPageTokenExpiresAt(pageAccessToken),
      refreshTokenExpiresAt: userTokens.expiresAt,
      scopes: userTokens.scopes,
      tokenType: "page",
    };

    const profile: AccountProfile = {
      providerAccountId: option.id,
      username: option.username ?? option.label,
      displayName: option.label,
      avatarUrl: option.avatarUrl,
      tokenType: "page",
      metadata: { pageId: option.id, pageName: option.label },
    };

    return { tokens, profile };
  },
};

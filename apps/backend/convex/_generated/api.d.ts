/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as billing from "../billing.js";
import type * as billingConfig from "../billingConfig.js";
import type * as billingWebhook from "../billingWebhook.js";
import type * as crons from "../crons.js";
import type * as errors from "../errors.js";
import type * as hexclave_auth from "../hexclave/auth.js";
import type * as http from "../http.js";
import type * as media_r2 from "../media/r2.js";
import type * as oauth_accounts from "../oauth/accounts.js";
import type * as oauth_crypto from "../oauth/crypto.js";
import type * as oauth_limits from "../oauth/limits.js";
import type * as oauth_returnPath from "../oauth/returnPath.js";
import type * as oauth_server from "../oauth/server.js";
import type * as oauth_sessions from "../oauth/sessions.js";
import type * as postConfig from "../postConfig.js";
import type * as posts from "../posts.js";
import type * as publishing from "../publishing.js";
import type * as publishing_actions from "../publishing/actions.js";
import type * as publishing_apiVersions from "../publishing/apiVersions.js";
import type * as publishing_helpers from "../publishing/helpers.js";
import type * as publishing_linkedin from "../publishing/linkedin.js";
import type * as publishing_meta from "../publishing/meta.js";
import type * as publishing_threads from "../publishing/threads.js";
import type * as publishing_tiktok from "../publishing/tiktok.js";
import type * as publishing_tokenRefresh from "../publishing/tokenRefresh.js";
import type * as publishing_x from "../publishing/x.js";
import type * as publishing_youtube from "../publishing/youtube.js";
import type * as superAdminAccess from "../superAdminAccess.js";
import type * as writeGuards from "../writeGuards.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  billing: typeof billing;
  billingConfig: typeof billingConfig;
  billingWebhook: typeof billingWebhook;
  crons: typeof crons;
  errors: typeof errors;
  "hexclave/auth": typeof hexclave_auth;
  http: typeof http;
  "media/r2": typeof media_r2;
  "oauth/accounts": typeof oauth_accounts;
  "oauth/crypto": typeof oauth_crypto;
  "oauth/limits": typeof oauth_limits;
  "oauth/returnPath": typeof oauth_returnPath;
  "oauth/server": typeof oauth_server;
  "oauth/sessions": typeof oauth_sessions;
  postConfig: typeof postConfig;
  posts: typeof posts;
  publishing: typeof publishing;
  "publishing/actions": typeof publishing_actions;
  "publishing/apiVersions": typeof publishing_apiVersions;
  "publishing/helpers": typeof publishing_helpers;
  "publishing/linkedin": typeof publishing_linkedin;
  "publishing/meta": typeof publishing_meta;
  "publishing/threads": typeof publishing_threads;
  "publishing/tiktok": typeof publishing_tiktok;
  "publishing/tokenRefresh": typeof publishing_tokenRefresh;
  "publishing/x": typeof publishing_x;
  "publishing/youtube": typeof publishing_youtube;
  superAdminAccess: typeof superAdminAccess;
  writeGuards: typeof writeGuards;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  stack_auth: import("@hexclave/next/_generated/component.js").ComponentApi<"stack_auth">;
  r2: import("@convex-dev/r2/_generated/component.js").ComponentApi<"r2">;
  stripe: import("@convex-dev/stripe/_generated/component.js").ComponentApi<"stripe">;
};

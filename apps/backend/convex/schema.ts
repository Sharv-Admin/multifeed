import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const planKey = v.union(
  v.literal("creator"),
  v.literal("growth"),
  v.literal("agency"),
);

export const billingInterval = v.union(v.literal("month"), v.literal("year"));

export const billingStatus = v.union(
  v.literal("pending"),
  v.literal("active"),
  v.literal("renewed"),
  v.literal("updated"),
  v.literal("plan_changed"),
  v.literal("cancelled"),
  v.literal("on_hold"),
  v.literal("failed"),
  v.literal("expired"),
);

export const platform = v.union(
  v.literal("x"),
  v.literal("instagram"),
  v.literal("facebook"),
  v.literal("threads"),
  v.literal("linkedin"),
  v.literal("tiktok"),
  v.literal("youtube"),
);

export const postStatus = v.union(
  v.literal("draft"),
  v.literal("scheduled"),
  v.literal("publishing"),
  v.literal("published"),
  v.literal("failed"),
  v.literal("archived"),
);

export const postKind = v.union(
  v.literal("text"),
  v.literal("image"),
  v.literal("video"),
  v.literal("story"),
);

export const postPlacement = v.union(
  v.literal("feed"),
  v.literal("reel"),
  v.literal("story"),
  v.literal("short"),
);

export const platformSettings = v.object({
  placement: v.optional(postPlacement),
  title: v.optional(v.string()),
  altText: v.optional(v.string()),
  visibility: v.optional(
    v.union(
      v.literal("public"),
      v.literal("followers"),
      v.literal("private"),
      v.literal("unlisted"),
    ),
  ),
  shareToFeed: v.optional(v.boolean()),
  allowComments: v.optional(v.boolean()),
  allowDuet: v.optional(v.boolean()),
  allowStitch: v.optional(v.boolean()),
  notifySubscribers: v.optional(v.boolean()),
  madeForKids: v.optional(v.boolean()),
});

const targetStatus = v.union(
  v.literal("draft"),
  v.literal("scheduled"),
  v.literal("publishing"),
  v.literal("published"),
  v.literal("failed"),
  v.literal("skipped"),
);

export const targetClaimStatus = v.union(
  v.literal("claimed"),
  v.literal("resume"),
  v.literal("busy"),
  v.literal("done"),
  v.literal("missing"),
);

const publishedResult = {
  platformPostId: v.optional(v.string()),
  permalink: v.optional(v.string()),
};

/** Provider-specific checkpoints used to resume interrupted publishing. */
export const publishAttempt = v.union(
  v.object({
    kind: v.literal("x"),
    mediaIds: v.optional(v.array(v.string())),
    ...publishedResult,
  }),
  v.object({
    kind: v.literal("linkedin"),
    mediaIds: v.optional(v.array(v.string())),
    ...publishedResult,
  }),
  v.object({
    kind: v.literal("threads"),
    creationId: v.string(),
    ...publishedResult,
  }),
  v.object({
    kind: v.literal("instagram"),
    creationId: v.string(),
    childIds: v.optional(v.array(v.string())),
    ...publishedResult,
  }),
  v.object({
    kind: v.literal("tiktok"),
    publishId: v.string(),
    ...publishedResult,
  }),
  v.object({
    kind: v.literal("youtube"),
    uploadStarted: v.optional(v.boolean()),
    /** Resumable upload session URL so an interrupted upload can resume. */
    uploadUrl: v.optional(v.string()),
    ...publishedResult,
  }),
  v.object({ kind: v.literal("facebook"), ...publishedResult }),
  v.object({
    kind: v.literal("facebook_reel_video"),
    videoId: v.string(),
    uploadUrl: v.string(),
    finishRequested: v.optional(v.boolean()),
    ...publishedResult,
  }),
  v.object({
    kind: v.literal("facebook_story_video"),
    videoId: v.string(),
    pageId: v.string(),
    /** rupload endpoint so a resume can re-send file_url if needed. */
    uploadUrl: v.optional(v.string()),
    ...publishedResult,
  }),
);

const metricSyncStatus = v.union(
  v.literal("idle"),
  v.literal("queued"),
  v.literal("syncing"),
  v.literal("synced"),
  v.literal("failed"),
);

export const capability = v.union(
  v.literal("text"),
  v.literal("image"),
  v.literal("video"),
  v.literal("carousel"),
  v.literal("analytics"),
  v.literal("inbox"),
);

const accountStatus = v.union(
  v.literal("active"),
  v.literal("expired"),
  v.literal("revoked"),
  v.literal("error"),
);

export const tokenType = v.union(
  v.literal("user"),
  v.literal("page"),
  v.literal("organization"),
);

export default defineSchema({
  /** Shared mutation guards serialize aggregate invariants by logical scope. */
  writeGuards: defineTable({
    scope: v.string(),
    updatedAt: v.number(),
  }).index("by_scope", ["scope"]),

  billingSubscriptions: defineTable({
    teamId: v.string(),
    userId: v.string(),
    planKey,
    interval: billingInterval,
    status: billingStatus,
    dodoSubscriptionId: v.optional(v.string()),
    dodoCustomerId: v.optional(v.string()),
    dodoProductId: v.string(),
    dodoCheckoutSessionId: v.optional(v.string()),
    dodoCheckoutUrl: v.optional(v.string()),
    currentPeriodEnd: v.optional(v.number()),
    accessEndsAt: v.optional(v.number()),
    rawEventTimestamp: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_team_status_updated", ["teamId", "status", "updatedAt"])
    .index("by_subscription", ["dodoSubscriptionId"])
    .index("by_customer", ["dodoCustomerId"]),

  dodoWebhookEvents: defineTable({
    webhookId: v.string(),
    eventType: v.string(),
    processedAt: v.number(),
    eventTimestamp: v.optional(v.number()),
    teamId: v.optional(v.string()),
    subscriptionId: v.optional(v.string()),
    rawEvent: v.any(),
  }).index("by_webhook_id", ["webhookId"]),

  oauthSessions: defineTable({
    state: v.string(),
    teamId: v.string(),
    userId: v.string(),
    platform,
    codeVerifier: v.optional(v.string()),
    returnTo: v.optional(v.string()),
    phase: v.union(
      v.literal("authorize"),
      /** Authorize consumed; token exchange in progress (single-use). */
      v.literal("exchanging"),
      /** Account saved; retain briefly so repeated provider callbacks are safe. */
      v.literal("completed"),
    ),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_state", ["state"])
    .index("by_expiresAt", ["expiresAt"]),

  connectedAccounts: defineTable({
    teamId: v.string(),
    platform,
    providerAccountId: v.string(),
    username: v.string(),
    displayName: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    status: accountStatus,
    tokenType: v.optional(tokenType),
    capabilities: v.array(capability),
    scopes: v.array(v.string()),
    encryptedAccessToken: v.optional(v.string()),
    encryptedRefreshToken: v.optional(v.string()),
    tokenExpiresAt: v.optional(v.number()),
    refreshTokenExpiresAt: v.optional(v.number()),
    lastSyncedAt: v.optional(v.number()),
    metadata: v.optional(v.any()),
    errorMessage: v.optional(v.string()),
    connectedByUserId: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_team_status", ["teamId", "status"])
    .index("by_team_provider", ["teamId", "platform", "providerAccountId"]),

  mediaAssets: defineTable({
    teamId: v.string(),
    storageId: v.optional(v.id("_storage")),
    r2Key: v.optional(v.string()),
    publicUrl: v.optional(v.string()),
    externalUrl: v.optional(v.string()),
    kind: v.union(
      v.literal("image"),
      v.literal("video"),
      v.literal("document"),
    ),
    filename: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    durationMs: v.optional(v.number()),
    status: v.union(
      v.literal("uploading"),
      v.literal("ready"),
      v.literal("failed"),
    ),
    createdByUserId: v.string(),
    createdAt: v.number(),
  })
    .index("by_status_created", ["status", "createdAt"])
    .index("by_r2_key", ["r2Key"]),

  posts: defineTable({
    teamId: v.string(),
    createdByUserId: v.string(),
    updatedByUserId: v.optional(v.string()),
    title: v.optional(v.string()),
    body: v.string(),
    kind: postKind,
    status: postStatus,
    /** Epoch ms when the post should go out (drafts may omit). */
    scheduledFor: v.optional(v.number()),
    /** IANA timezone used when scheduling (e.g. America/New_York). */
    timezone: v.string(),
    /** Optional note for internal team context. */
    notes: v.optional(v.string()),
    /** Hex color hint for calendar chips. */
    calendarColor: v.optional(v.string()),
    /** Pending publishPost scheduler job so reschedules can cancel it. */
    publishJobId: v.optional(v.id("_scheduled_functions")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_team_status", ["teamId", "status"])
    .index("by_team_schedule", ["teamId", "status", "scheduledFor"])
    .index("by_team_scheduledFor", ["teamId", "scheduledFor"])
    .index("by_team_updated", ["teamId", "updatedAt"])
    .index("by_status_updatedAt", ["status", "updatedAt"])
    .index("by_status_scheduledFor", ["status", "scheduledFor"]),

  postMediaAssets: defineTable({
    postId: v.id("posts"),
    mediaAssetId: v.id("mediaAssets"),
    position: v.number(),
  })
    .index("by_post_position", ["postId", "position"])
    .index("by_media_asset", ["mediaAssetId"]),

  postTargets: defineTable({
    teamId: v.string(),
    postId: v.id("posts"),
    connectedAccountId: v.id("connectedAccounts"),
    platform,
    status: targetStatus,
    bodyOverride: v.optional(v.string()),
    firstComment: v.optional(v.string()),
    /** URL of a post this target should reply to or reference, when supported. */
    referenceUrl: v.optional(v.string()),
    /** Per-network placement and publishing controls. */
    platformSettings: v.optional(platformSettings),
    scheduledFor: v.optional(v.number()),
    publishedAt: v.optional(v.number()),
    platformPostId: v.optional(v.string()),
    platformPermalink: v.optional(v.string()),
    failureCode: v.optional(v.string()),
    failureMessage: v.optional(v.string()),
    publishAttempt: v.optional(publishAttempt),
    /** When set, a resumable target may be retried before the stale window. */
    resumeAt: v.optional(v.number()),
    attempts: v.number(),
    metricSyncStatus,
    metricSyncError: v.optional(v.string()),
    lastMetricSyncAt: v.optional(v.number()),
    nextMetricSyncAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_post", ["postId"])
    .index("by_team_status_scheduledFor", ["teamId", "status", "scheduledFor"])
    .index("by_account_schedule", [
      "connectedAccountId",
      "status",
      "scheduledFor",
    ]),

  postMetrics: defineTable({
    teamId: v.string(),
    postTargetId: v.id("postTargets"),
    capturedAt: v.number(),
    likes: v.optional(v.number()),
    comments: v.optional(v.number()),
    shares: v.optional(v.number()),
    saves: v.optional(v.number()),
    clicks: v.optional(v.number()),
    views: v.optional(v.number()),
    impressions: v.optional(v.number()),
    reach: v.optional(v.number()),
    raw: v.optional(v.any()),
  })
    .index("by_target_time", ["postTargetId", "capturedAt"])
    .index("by_team_time", ["teamId", "capturedAt"]),

  inboxItems: defineTable({
    teamId: v.string(),
    connectedAccountId: v.id("connectedAccounts"),
    platform,
    kind: v.union(
      v.literal("comment"),
      v.literal("mention"),
      v.literal("message"),
    ),
    externalId: v.string(),
    authorName: v.string(),
    authorHandle: v.optional(v.string()),
    body: v.string(),
    status: v.union(v.literal("open"), v.literal("done"), v.literal("ignored")),
    receivedAt: v.number(),
    updatedAt: v.number(),
  }).index("by_account_external", ["connectedAccountId", "externalId"]),
});

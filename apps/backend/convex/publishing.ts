import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { encryptSecret } from "./oauth/crypto";
import schema, { publishAttempt, targetClaimStatus } from "./schema";
import { mediaAssetOutputValidator } from "./media/r2";
import { MAX_MEDIA_ASSETS_PER_POST, MAX_TARGETS_PER_POST } from "./postConfig";
import { serializeScope } from "./writeGuards";

const postValidator = v.object({
  ...schema.tables.posts.validator.fields,
  _id: v.id("posts"),
  _creationTime: v.number(),
});
const targetValidator = v.object({
  ...schema.tables.postTargets.validator.fields,
  _id: v.id("postTargets"),
  _creationTime: v.number(),
});
const accountValidator = v.object({
  ...schema.tables.connectedAccounts.validator.fields,
  _id: v.id("connectedAccounts"),
  _creationTime: v.number(),
});

const BATCH = 100;
const STALE_PUBLISH_MS = 12 * 60 * 1000;
const MAX_PUBLISH_ATTEMPTS = 40;

async function loadTargets(ctx: MutationCtx, postId: Doc<"posts">["_id"]) {
  return await ctx.db
    .query("postTargets")
    .withIndex("by_post", (q) => q.eq("postId", postId))
    .take(MAX_TARGETS_PER_POST + 1);
}

async function scheduleTargets(
  ctx: MutationCtx,
  post: Doc<"posts">,
  now: number,
) {
  const targets = await loadTargets(ctx, post._id);
  if (targets.length === 0 || targets.length > MAX_TARGETS_PER_POST) {
    if (targets.length > MAX_TARGETS_PER_POST) {
      console.error(
        `[publishing] post ${post._id} exceeds the ${MAX_TARGETS_PER_POST} target limit`,
      );
    }
    await ctx.db.patch("posts", post._id, {
      status: "failed",
      publishJobId: undefined,
      updatedAt: now,
    });
    return;
  }

  await ctx.db.patch("posts", post._id, {
    status: "publishing",
    publishJobId: undefined,
    updatedAt: now,
  });

  if (
    targets.every(
      (target) =>
        target.status === "published" ||
        target.status === "failed" ||
        target.status === "skipped",
    )
  ) {
    await reconcileStatus(ctx, post._id);
    return;
  }

  for (const target of targets) {
    if (target.status === "published" || target.status === "skipped") continue;
    if (target.status === "failed") continue;
    const resumeDue = target.resumeAt != null && target.resumeAt <= now;
    if (
      target.status === "publishing" &&
      target.attempts > 0 &&
      !resumeDue &&
      now - target.updatedAt < STALE_PUBLISH_MS
    ) {
      continue;
    }
    await ctx.scheduler.runAfter(
      0,
      internal.publishing.actions.publishOneTarget,
      {
        postId: post._id,
        targetId: target._id,
      },
    );
  }
}

export const publishPost = internalMutation({
  args: { postId: v.id("posts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Serialize fan-out per post so concurrent triggers cannot double-schedule.
    await serializeScope(ctx, `publish-post:${args.postId}`);
    const post = await ctx.db.get("posts", args.postId);
    if (!post) return null;
    // Old jobs can still run after rescheduling or moving a post back to drafts.
    if (post.status !== "scheduled" && post.status !== "publishing")
      return null;
    if (
      post.status === "scheduled" &&
      post.scheduledFor != null &&
      post.scheduledFor > Date.now()
    ) {
      return null;
    }
    await scheduleTargets(ctx, post, Date.now());
    return null;
  },
});

export const publishDuePosts = internalMutation({
  args: {},
  returns: v.object({ processed: v.number(), hasMore: v.boolean() }),
  handler: async (ctx) => {
    const now = Date.now();
    const scheduledDue = await ctx.db
      .query("posts")
      .withIndex("by_status_scheduledFor", (q) =>
        q.eq("status", "scheduled").lte("scheduledFor", now),
      )
      .take(BATCH);
    const publishingDue = await ctx.db
      .query("posts")
      .withIndex("by_status_updatedAt", (q) =>
        q.eq("status", "publishing").lte("updatedAt", now - 60_000),
      )
      .take(BATCH);
    const due = [...scheduledDue, ...publishingDue];
    for (const post of due) {
      // Isolate each post so the cron cannot exceed the scheduler's fan-out limit.
      await ctx.scheduler.runAfter(0, internal.publishing.publishPost, {
        postId: post._id,
      });
    }
    return {
      processed: due.length,
      hasMore: scheduledDue.length === BATCH || publishingDue.length === BATCH,
    };
  },
});

export const getPostForPublish = internalQuery({
  args: { postId: v.id("posts") },
  returns: v.union(postValidator, v.null()),
  handler: async (ctx, args) => ctx.db.get("posts", args.postId),
});

export const getTargetForPublish = internalQuery({
  args: { targetId: v.id("postTargets") },
  returns: v.union(targetValidator, v.null()),
  handler: async (ctx, args) => ctx.db.get("postTargets", args.targetId),
});

export const getAccountForPublish = internalQuery({
  args: { accountId: v.id("connectedAccounts") },
  returns: v.union(accountValidator, v.null()),
  handler: async (ctx, args) => ctx.db.get("connectedAccounts", args.accountId),
});

export const getMediaForPost = internalQuery({
  args: { postId: v.id("posts") },
  returns: v.array(mediaAssetOutputValidator),
  handler: async (ctx, args) => {
    const links = await ctx.db
      .query("postMediaAssets")
      .withIndex("by_post_position", (q) => q.eq("postId", args.postId))
      .take(MAX_MEDIA_ASSETS_PER_POST + 1);
    const assets = await Promise.all(
      links.map((link) => ctx.db.get("mediaAssets", link.mediaAssetId)),
    );
    return assets.filter(
      (asset): asset is Doc<"mediaAssets"> => asset !== null,
    );
  },
});

export const claimTargetForPublish = internalMutation({
  args: { targetId: v.id("postTargets") },
  returns: targetClaimStatus,
  handler: async (ctx, args) => {
    const target = await ctx.db.get("postTargets", args.targetId);
    if (!target) return "missing";
    const post = await ctx.db.get("posts", target.postId);
    if (!post || post.status !== "publishing") return "missing";
    if (target.status === "published" || target.status === "skipped")
      return "done";
    const now = Date.now();
    // A resumable checkpoint may opt back in before the stale window ends.
    const resumeDue = target.resumeAt != null && target.resumeAt <= now;
    if (
      target.status === "publishing" &&
      target.attempts > 0 &&
      !resumeDue &&
      now - target.updatedAt < STALE_PUBLISH_MS
    ) {
      return "busy";
    }
    if (target.status === "failed") return "done";
    const hasAttempt = target.publishAttempt != null;
    if (target.status === "publishing" && target.attempts > 0 && hasAttempt) {
      await ctx.db.patch("postTargets", args.targetId, {
        attempts: target.attempts + 1,
        resumeAt: undefined,
        updatedAt: now,
      });
      return "resume";
    }
    if (target.status === "publishing" && target.attempts > 0) {
      await ctx.db.patch("postTargets", args.targetId, {
        status: "failed",
        failureCode: "stale_publish",
        failureMessage:
          "This publish timed out after the network may have already accepted it. Check the account before retrying.",
        publishAttempt: undefined,
        resumeAt: undefined,
        attempts: target.attempts + 1,
        updatedAt: now,
      });
      return "done";
    }
    await ctx.db.patch("postTargets", args.targetId, {
      status: "publishing",
      attempts: target.attempts + 1,
      failureCode: undefined,
      failureMessage: undefined,
      // Keep a checkpoint that already reached the provider so a reclaim
      // can short-circuit instead of publishing a duplicate.
      publishAttempt: target.publishAttempt?.platformPostId
        ? target.publishAttempt
        : undefined,
      resumeAt: undefined,
      updatedAt: now,
    });
    return "claimed";
  },
});

export const applyRefreshedToken = internalMutation({
  args: {
    accountId: v.id("connectedAccounts"),
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    refreshTokenExpiresAt: v.optional(v.number()),
  },
  returns: v.union(accountValidator, v.null()),
  handler: async (ctx, args) => {
    // Serialize token writes per account so concurrent targets cannot
    // interleave a refresh apply with an expire (or another refresh).
    await serializeScope(ctx, `token-refresh:${args.accountId}`);
    const account = await ctx.db.get("connectedAccounts", args.accountId);
    if (!account) return null;
    const now = Date.now();
    const patch: Partial<Doc<"connectedAccounts">> = {
      encryptedAccessToken: await encryptSecret(args.accessToken),
      tokenExpiresAt: args.expiresAt,
      status: "active",
      errorMessage: undefined,
      updatedAt: now,
    };
    if (args.refreshToken) {
      patch.encryptedRefreshToken = await encryptSecret(args.refreshToken);
      patch.refreshTokenExpiresAt = args.refreshTokenExpiresAt;
    }
    await ctx.db.patch("connectedAccounts", account._id, patch);
    return await ctx.db.get("connectedAccounts", account._id);
  },
});

export const markAccountExpired = internalMutation({
  args: { accountId: v.id("connectedAccounts"), errorMessage: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await serializeScope(ctx, `token-refresh:${args.accountId}`);
    const account = await ctx.db.get("connectedAccounts", args.accountId);
    if (!account) return null;
    // A concurrent refresh may have already stored a fresh token; only expire
    // the account when it still lacks a usable access token.
    if (
      account.status === "active" &&
      account.encryptedAccessToken &&
      (account.tokenExpiresAt == null ||
        account.tokenExpiresAt > Date.now() + 60_000)
    ) {
      return null;
    }
    await ctx.db.patch("connectedAccounts", args.accountId, {
      status: "expired",
      errorMessage: args.errorMessage.slice(0, 1000),
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const savePublishAttempt = internalMutation({
  args: {
    targetId: v.id("postTargets"),
    attempt: publishAttempt,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const target = await ctx.db.get("postTargets", args.targetId);
    if (!target || target.status !== "publishing") {
      // A lost checkpoint can cause a duplicate post on resume — fail loudly.
      throw new Error(
        "Publish target is no longer publishing; checkpoint not saved",
      );
    }
    await ctx.db.patch("postTargets", args.targetId, {
      publishAttempt: args.attempt,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Arm a resumable target for a near-term retry. Returns false when the target
 * already reached a terminal state or exhausted its attempt budget (in which
 * case it is marked failed so it cannot stall forever).
 */
export const markTargetResumable = internalMutation({
  args: {
    targetId: v.id("postTargets"),
    resumeAt: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const target = await ctx.db.get("postTargets", args.targetId);
    if (!target || target.status !== "publishing") return false;
    if (target.attempts >= MAX_PUBLISH_ATTEMPTS) {
      await ctx.db.patch("postTargets", args.targetId, {
        status: "failed",
        failureCode: "publish_attempts_exceeded",
        failureMessage:
          "Publishing kept getting interrupted by the platform. Check the account before retrying.",
        publishAttempt: target.publishAttempt?.platformPostId
          ? target.publishAttempt
          : undefined,
        resumeAt: undefined,
        updatedAt: Date.now(),
      });
      return false;
    }
    await ctx.db.patch("postTargets", args.targetId, {
      resumeAt: args.resumeAt,
      updatedAt: Date.now(),
    });
    return true;
  },
});

export const markTargetPublished = internalMutation({
  args: {
    targetId: v.id("postTargets"),
    platformPostId: v.string(),
    permalink: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const target = await ctx.db.get("postTargets", args.targetId);
    if (!target || target.status === "published") return null;
    await ctx.db.patch("postTargets", args.targetId, {
      status: "published",
      publishedAt: Date.now(),
      platformPostId: args.platformPostId,
      platformPermalink: args.permalink,
      failureCode: undefined,
      failureMessage: undefined,
      publishAttempt: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const noteFirstCommentError = internalMutation({
  args: {
    targetId: v.id("postTargets"),
    firstCommentError: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const target = await ctx.db.get("postTargets", args.targetId);
    if (!target || target.status !== "published") return null;
    await ctx.db.patch("postTargets", args.targetId, {
      failureCode: "first_comment_failed",
      failureMessage: args.firstCommentError,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const markTargetFailed = internalMutation({
  args: {
    targetId: v.id("postTargets"),
    failureCode: v.string(),
    failureMessage: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const target = await ctx.db.get("postTargets", args.targetId);
    if (!target || target.status === "published") return null;
    await ctx.db.patch("postTargets", args.targetId, {
      status: "failed",
      failureCode: args.failureCode,
      failureMessage: args.failureMessage,
      // Keep a checkpoint that already reached the provider so a retry can
      // dedupe instead of publishing a duplicate.
      publishAttempt: target.publishAttempt?.platformPostId
        ? target.publishAttempt
        : undefined,
      resumeAt: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

async function reconcileStatus(ctx: MutationCtx, postId: Doc<"posts">["_id"]) {
  const post = await ctx.db.get("posts", postId);
  if (!post || post.status !== "publishing") return null;
  const targets = await loadTargets(ctx, postId);
  if (targets.length === 0 || targets.length > MAX_TARGETS_PER_POST) {
    if (targets.length > MAX_TARGETS_PER_POST) {
      console.error(
        `[publishing] post ${postId} exceeds the ${MAX_TARGETS_PER_POST} target limit`,
      );
    }
    await ctx.db.patch("posts", postId, {
      status: "failed",
      updatedAt: Date.now(),
    });
    return null;
  }
  const hasPublished = targets.some((target) => target.status === "published");
  const hasPublishing = targets.some(
    (target) =>
      target.status === "publishing" ||
      target.status === "scheduled" ||
      target.status === "draft",
  );
  const status: Doc<"posts">["status"] = hasPublishing
    ? "publishing"
    : hasPublished
      ? "published"
      : "failed";
  await ctx.db.patch("posts", postId, { status, updatedAt: Date.now() });
  return null;
}

export const reconcilePostStatus = internalMutation({
  args: { postId: v.id("posts") },
  returns: v.null(),
  handler: async (ctx, args) => reconcileStatus(ctx, args.postId),
});

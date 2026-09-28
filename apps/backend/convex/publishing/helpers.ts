import type { Doc } from "../_generated/dataModel";

export type PublishAttempt = NonNullable<Doc<"postTargets">["publishAttempt"]>;

export type PublishInput = {
  post: Doc<"posts">;
  target: Doc<"postTargets">;
  account: Doc<"connectedAccounts">;
  media: Doc<"mediaAssets">[];
  accessToken: string;
  existingAttempt?: PublishAttempt;
  saveAttempt?: (attempt: PublishAttempt) => Promise<void>;
};

export type PublishedPost = { platformPostId: string; permalink?: string };

export function effectiveCaption(body: string, override?: string) {
  return override?.trim() || body.trim();
}

export function tiktokPrivacyLevel(visibility?: string) {
  if (visibility === "followers" || visibility === "private")
    return "SELF_ONLY";
  return "PUBLIC_TO_EVERYONE";
}

/** TikTok disables an interaction only when the composer explicitly turns it off. */
export function tiktokInteractionDisabled(enabled?: boolean) {
  return enabled === false;
}

const TIKTOK_MAX_SINGLE_CHUNK = 64 * 1024 * 1024;
const TIKTOK_CHUNK_SIZE = 10 * 1024 * 1024;

export function tiktokChunkPlan(videoSize: number) {
  if (videoSize <= TIKTOK_MAX_SINGLE_CHUNK) {
    return { chunkSize: videoSize, totalChunkCount: 1 };
  }
  return {
    chunkSize: TIKTOK_CHUNK_SIZE,
    totalChunkCount: Math.ceil(videoSize / TIKTOK_CHUNK_SIZE),
  };
}

export function youtubePrivacy(visibility?: string) {
  if (visibility === "private") return "private";
  if (visibility === "unlisted") return "unlisted";
  return "public";
}

/** LinkedIn only supports PUBLIC and CONNECTIONS for member/org posts. */
export function linkedinVisibility(visibility?: string) {
  if (visibility === "followers" || visibility === "private") {
    return "CONNECTIONS";
  }
  return "PUBLIC";
}

export function tweetIdFromUrl(url: string | undefined) {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.pathname.match(/\/status\/(\d+)/)?.[1];
  } catch {
    return undefined;
  }
}

export function linkedinAuthorUrn(
  providerAccountId: string,
  metadata?: Record<string, unknown>,
) {
  const candidate = metadata?.authorUrn ?? metadata?.author ?? metadata?.urn;
  if (typeof candidate === "string" && candidate.startsWith("urn:li:")) {
    return candidate;
  }
  const orgId = metadata?.organizationId ?? metadata?.organizationUrn;
  if (typeof orgId === "string" && orgId) {
    return orgId.startsWith("urn:li:") ? orgId : `urn:li:organization:${orgId}`;
  }
  return `urn:li:person:${providerAccountId}`;
}

export function interpretTikTokStatus(status?: string) {
  if (status === "PUBLISH_COMPLETE") return "complete" as const;
  if (status === "SEND_TO_USER_INBOX") return "inbox" as const;
  if (status === "FAILED") return "failed" as const;
  return "pending" as const;
}

export function publishedFromAttempt(
  attempt?: PublishAttempt | Partial<PublishedPost>,
) {
  if (typeof attempt?.platformPostId !== "string" || !attempt.platformPostId) {
    return null;
  }
  return {
    platformPostId: attempt.platformPostId,
    permalink:
      typeof attempt.permalink === "string" ? attempt.permalink : undefined,
  };
}

export class ResumablePublishError extends Error {
  readonly resumable = true;
  constructor(message: string) {
    super(message);
    this.name = "ResumablePublishError";
  }
}

export function isResumablePublishError(error: unknown) {
  return (
    error instanceof ResumablePublishError ||
    (error instanceof Error && "resumable" in error && error.resumable === true)
  );
}

const REQUIRED_PUBLISH_SCOPES: Record<string, string[]> = {
  x: ["tweet.write", "media.write"],
  tiktok: ["video.publish"],
  threads: ["threads_content_publish"],
  facebook: ["pages_manage_posts"],
  instagram: ["instagram_content_publish"],
  linkedin: ["w_member_social"],
  youtube: ["https://www.googleapis.com/auth/youtube.upload"],
};

export function missingPublishScopes(platform: string, scopes: string[]) {
  const required = REQUIRED_PUBLISH_SCOPES[platform] ?? [];
  if (scopes.length === 0) {
    return platform === "x" || platform === "tiktok" || platform === "threads"
      ? required
      : [];
  }
  return required.filter((scope) => !scopes.includes(scope));
}

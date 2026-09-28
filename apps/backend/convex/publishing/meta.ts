"use node";

import type { PublishInput, PublishedPost } from "./helpers";
import type { Doc } from "../_generated/dataModel";
import { META_GRAPH } from "./apiVersions";
import {
  effectiveCaption,
  publishedFromAttempt,
  ResumablePublishError,
} from "./helpers";

const GRAPH = META_GRAPH;
const TIMEOUT_MS = 60_000;

function mediaUrl(asset: Doc<"mediaAssets">): string {
  const url = asset.publicUrl ?? asset.externalUrl;
  if (!url) throw new Error(`Media URL missing for ${asset.filename}`);
  return url;
}

type GraphResponse = {
  id?: string;
  post_id?: string;
  video_id?: string;
  upload_url?: string;
  permalink?: string;
  permalink_url?: string;
  status_code?: string;
  status?: {
    video_status?: string;
    uploading_phase?: { status?: string };
    processing_phase?: { status?: string };
    publishing_phase?: { status?: string };
  };
  error?: { message?: string; code?: number };
  message?: string;
  success?: boolean;
};

async function graphFetch(
  url: string,
  init: RequestInit,
): Promise<GraphResponse> {
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = (await res.json().catch(() => ({}))) as GraphResponse;
  if (!res.ok) {
    const error = json.error;
    const message = error?.message ?? json.message ?? `HTTP ${res.status}`;
    const code = error?.code;
    if (
      res.status === 429 ||
      code === 4 ||
      code === 80004 ||
      code === 368 ||
      message.toLowerCase().includes("rate")
    ) {
      console.error(
        `[meta] rate limited ${new URL(url).pathname}: ${message} code=${code}`,
      );
    } else {
      console.error(`[meta] Graph error ${new URL(url).pathname}: ${message}`);
    }
    throw new Error(message);
  }
  return json;
}

async function facebookPermalink(
  id: string,
  accessToken: string,
  fallback: string,
) {
  const data = await graphFetch(`${GRAPH}/${id}?fields=permalink_url`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  }).catch((): GraphResponse => ({}));
  return typeof data.permalink_url === "string" && data.permalink_url
    ? data.permalink_url
    : fallback;
}

async function facebookPublished(
  id: string,
  accessToken: string,
  saveAttempt: PublishInput["saveAttempt"],
  fallback: string,
) {
  // Checkpoint the post id before any further I/O so a crash cannot
  // double-publish; the permalink lookup is best-effort and retried.
  await saveAttempt?.({ kind: "facebook", platformPostId: id });
  const permalink = await facebookPermalink(id, accessToken, fallback);
  await saveAttempt?.({ kind: "facebook", platformPostId: id, permalink });
  return { platformPostId: id, permalink };
}

async function publishFacebookReel(
  params: PublishInput,
): Promise<PublishedPost> {
  const {
    post,
    target,
    account,
    media,
    accessToken,
    existingAttempt,
    saveAttempt,
  } = params;
  const asset = media[0];
  if (media.length !== 1 || asset?.kind !== "video") {
    throw new Error("Facebook reels require one video");
  }
  const endpoint = `${GRAPH}/${account.providerAccountId}/video_reels`;
  let attempt =
    existingAttempt?.kind === "facebook_reel_video"
      ? existingAttempt
      : undefined;
  let status: GraphResponse["status"];
  if (!attempt) {
    const started = await graphFetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        upload_phase: "start",
        access_token: accessToken,
      }),
    });
    if (!started.video_id || !started.upload_url) {
      throw new Error("Facebook reel upload session missing");
    }
    attempt = {
      kind: "facebook_reel_video",
      videoId: started.video_id,
      uploadUrl: started.upload_url,
    };
    await saveAttempt?.(attempt);
  } else {
    const response = await graphFetch(
      `${GRAPH}/${attempt.videoId}?fields=status`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    status = response.status;
  }

  const phases = [
    status?.uploading_phase,
    status?.processing_phase,
    status?.publishing_phase,
  ];
  if (
    status?.video_status === "error" ||
    phases.some((phase) => phase?.status === "error")
  ) {
    throw new Error("Facebook reel processing failed");
  }
  if (status?.publishing_phase?.status === "complete") {
    return facebookPublished(
      attempt.videoId,
      accessToken,
      saveAttempt,
      `https://www.facebook.com/reel/${attempt.videoId}`,
    );
  }
  if (
    attempt.finishRequested ||
    status?.publishing_phase?.status === "in_progress"
  ) {
    throw new ResumablePublishError("Facebook reel is still publishing");
  }
  if (!status || status.uploading_phase?.status === "not_started") {
    const uploaded = await graphFetch(attempt.uploadUrl, {
      method: "POST",
      headers: {
        Authorization: `OAuth ${accessToken}`,
        file_url: mediaUrl(asset),
      },
    });
    if (uploaded.success !== true) {
      throw new Error("Facebook reel upload was not accepted");
    }
  } else if (status.uploading_phase?.status !== "complete") {
    throw new ResumablePublishError("Facebook reel is still uploading");
  }

  // Finishing starts encoding/publication; do not wait for video_status=ready first.
  const finished = await graphFetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      upload_phase: "finish",
      video_id: attempt.videoId,
      video_state: "PUBLISHED",
      description: effectiveCaption(post.body, target.bodyOverride),
      ...(target.platformSettings?.title
        ? { title: target.platformSettings.title }
        : {}),
      access_token: accessToken,
    }),
  });
  if (finished.success !== true) {
    throw new Error("Facebook reel publication was not accepted");
  }
  await saveAttempt?.({ ...attempt, finishRequested: true });
  throw new ResumablePublishError("Facebook reel is still publishing");
}

export async function publishToFacebook(
  params: PublishInput,
): Promise<PublishedPost> {
  const {
    post,
    target,
    account,
    media,
    accessToken,
    existingAttempt,
    saveAttempt,
  } = params;
  const alreadyPublished = publishedFromAttempt(existingAttempt);
  if (alreadyPublished) return alreadyPublished;
  const body = effectiveCaption(post.body, target.bodyOverride);
  const pageId = account.providerAccountId;
  if (!pageId || typeof pageId !== "string")
    throw new Error("Facebook Page ID missing");

  if (post.kind === "video" && target.platformSettings?.placement === "reel") {
    return publishFacebookReel(params);
  }

  if (post.kind === "text" && media.length === 0) {
    const data = await graphFetch(`${GRAPH}/${pageId}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ message: body, access_token: accessToken }),
    });
    const id = data.id ?? data.post_id;
    if (!id) throw new Error("Facebook: no post id returned");
    return facebookPublished(
      id,
      accessToken,
      saveAttempt,
      `https://facebook.com/${id}`,
    );
  }

  const isStory =
    post.kind === "story" || target.platformSettings?.placement === "story";
  if (isStory) {
    if (media.length === 0) throw new Error("Facebook stories require media");
    const asset = media[0]!;
    const url = mediaUrl(asset);
    if (asset.kind === "video" || post.kind === "video") {
      const storyAttempt =
        existingAttempt?.kind === "facebook_story_video"
          ? existingAttempt
          : undefined;
      let videoId = storyAttempt?.videoId;
      const transferToStoryUpload = async (uploadUrl: string) => {
        // Meta's rupload endpoint takes the hosted file URL as a header.
        const uploadRes = await fetch(uploadUrl, {
          method: "POST",
          headers: { Authorization: `OAuth ${accessToken}`, file_url: url },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!uploadRes.ok) {
          throw new Error(
            `Facebook story video upload failed: ${uploadRes.status}`,
          );
        }
      };
      if (!videoId) {
        const start = await graphFetch(`${GRAPH}/${pageId}/video_stories`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            upload_phase: "start",
            access_token: accessToken,
          }),
        });
        videoId = start.video_id;
        const uploadUrl = start.upload_url;
        if (!videoId || !uploadUrl)
          throw new Error("Facebook story video start failed");
        await saveAttempt?.({
          kind: "facebook_story_video",
          videoId,
          pageId,
          uploadUrl,
        });
        await transferToStoryUpload(uploadUrl);
      } else if (storyAttempt?.uploadUrl) {
        // A resume may have lost the transfer POST: re-send file_url unless
        // the upload session already reports it complete.
        const status = await graphFetch(
          `${GRAPH}/${videoId}?fields=status&access_token=${encodeURIComponent(accessToken)}`,
          { method: "GET" },
        ).catch((): GraphResponse => ({}));
        const phase = String(
          status.status?.uploading_phase?.status ?? "",
        ).toLowerCase();
        if (phase !== "complete") {
          await transferToStoryUpload(storyAttempt.uploadUrl);
        }
      }
      for (let attempt = 0; attempt < 24; attempt += 1) {
        const status = await graphFetch(
          `${GRAPH}/${videoId}?fields=status&access_token=${encodeURIComponent(accessToken)}`,
          { method: "GET" },
        ).catch(() => ({ status: { video_status: "in_progress" } }));
        const videoStatus = String(
          status.status?.video_status ?? "",
        ).toLowerCase();
        if (videoStatus === "error")
          throw new Error("Facebook story video processing failed");
        if (videoStatus === "upload_complete" || videoStatus === "ready") break;
        if (attempt === 23)
          throw new ResumablePublishError(
            "Facebook story video is still processing",
          );
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
      const finish = await graphFetch(`${GRAPH}/${pageId}/video_stories`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          upload_phase: "finish",
          video_id: videoId,
          access_token: accessToken,
        }),
      });
      const id = finish.post_id ?? videoId;
      return facebookPublished(
        id,
        accessToken,
        saveAttempt,
        `https://www.facebook.com/stories/${id}`,
      );
    }
    const photo = await graphFetch(`${GRAPH}/${pageId}/photos`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        url,
        published: "false",
        access_token: accessToken,
      }),
    });
    if (!photo.id) throw new Error("Facebook story photo upload failed");
    const published = await graphFetch(`${GRAPH}/${pageId}/photo_stories`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        photo_id: photo.id,
        access_token: accessToken,
      }),
    });
    const id = published.post_id ?? photo.id;
    return facebookPublished(
      id,
      accessToken,
      saveAttempt,
      `https://www.facebook.com/stories/${id}`,
    );
  }

  if (post.kind === "image") {
    if (media.length === 0)
      throw new Error("Facebook image post requires media");
    if (media.length === 1) {
      const url = mediaUrl(media[0]!);
      const data = await graphFetch(`${GRAPH}/${pageId}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          url,
          access_token: accessToken,
          published: "true",
          caption: body,
        }),
      });
      const id = data.post_id ?? data.id;
      if (!id) throw new Error("Facebook photo: no id");
      return facebookPublished(
        id,
        accessToken,
        saveAttempt,
        `https://facebook.com/${id}`,
      );
    }
    const uploaded: string[] = [];
    for (const m of media) {
      const url = mediaUrl(m);
      const data = await graphFetch(`${GRAPH}/${pageId}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          url,
          access_token: accessToken,
          published: "false",
        }),
      });
      if (!data.id) throw new Error("Facebook carousel upload failed");
      uploaded.push(data.id);
    }
    const qs = new URLSearchParams({
      message: body,
      access_token: accessToken,
    });
    uploaded.forEach((id, i) =>
      qs.set(`attached_media[${i}]`, JSON.stringify({ media_fbid: id })),
    );
    const data = await graphFetch(`${GRAPH}/${pageId}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: qs,
    });
    const id = data.id ?? data.post_id;
    if (!id) throw new Error("Facebook carousel publish failed");
    return facebookPublished(
      id,
      accessToken,
      saveAttempt,
      `https://facebook.com/${id}`,
    );
  }

  if (post.kind === "video") {
    const m = media[0];
    if (!m) throw new Error("Video required");
    const url = mediaUrl(m);
    const data = await graphFetch(`${GRAPH}/${pageId}/videos`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        file_url: url,
        description: body,
        access_token: accessToken,
      }),
    });
    const id = data.id;
    if (!id) throw new Error("Facebook video: no id");
    return facebookPublished(
      id,
      accessToken,
      saveAttempt,
      `https://facebook.com/${id}`,
    );
  }

  throw new Error(`Facebook: unsupported kind ${post.kind}`);
}

export async function publishToInstagram(
  params: PublishInput,
): Promise<PublishedPost> {
  const { post, target, media, accessToken, existingAttempt, saveAttempt } =
    params;
  const alreadyPublished = publishedFromAttempt(existingAttempt);
  if (alreadyPublished) return alreadyPublished;
  const body = effectiveCaption(post.body, target.bodyOverride);
  const igUserId =
    (params.account.metadata as Record<string, unknown> | undefined)
      ?.igUserId ?? params.account.providerAccountId;
  if (!igUserId || typeof igUserId !== "string")
    throw new Error("Instagram user ID missing");
  const placement = target.platformSettings?.placement;
  const isReel = placement === "reel" || post.kind === "video";
  const isStory = placement === "story" || post.kind === "story";

  async function createContainer(
    form: Record<string, string>,
  ): Promise<string> {
    const qs = new URLSearchParams({ access_token: accessToken, ...form });
    const data = await graphFetch(`${GRAPH}/${igUserId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: qs,
    });
    if (!data.id) throw new Error("Instagram media creation failed");
    return data.id;
  }

  async function publishContainer(creationId: string): Promise<string> {
    const data = await graphFetch(`${GRAPH}/${igUserId}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        creation_id: creationId,
        access_token: accessToken,
      }),
    });
    if (!data.id) throw new Error("Instagram publish failed");
    return data.id;
  }

  async function permalinkFor(id: string) {
    const data = await graphFetch(
      `${GRAPH}/${id}?fields=permalink&access_token=${encodeURIComponent(accessToken)}`,
      { method: "GET" },
    ).catch((): GraphResponse => ({}));
    return typeof data.permalink === "string"
      ? data.permalink
      : `https://www.instagram.com/p/${id}`;
  }

  async function waitForContainer(creationId: string) {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const status = await graphFetch(
        `${GRAPH}/${creationId}?fields=status_code&access_token=${encodeURIComponent(accessToken)}`,
        { method: "GET" },
      ).catch(() => ({ status_code: "IN_PROGRESS" }));
      const code = String(status.status_code ?? "").toUpperCase();
      if (code === "PUBLISHED") return "published" as const;
      if (code === "FINISHED") return "ready" as const;
      if (code === "ERROR" || code === "EXPIRED") {
        throw new Error(`Instagram media processing failed (${code})`);
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    throw new ResumablePublishError("Instagram media is still processing");
  }

  async function finishContainer(creationId: string) {
    const state = await waitForContainer(creationId);
    const id =
      state === "published" ? creationId : await publishContainer(creationId);
    // Checkpoint the media id before the permalink lookup so a crash cannot
    // publish the same container twice.
    await saveAttempt?.({ kind: "instagram", platformPostId: id, creationId });
    const permalink = await permalinkFor(id);
    await saveAttempt?.({
      kind: "instagram",
      platformPostId: id,
      permalink,
      creationId,
    });
    return { platformPostId: id, permalink };
  }

  if (existingAttempt?.kind === "instagram") {
    return finishContainer(existingAttempt.creationId);
  }

  if (post.kind === "text")
    throw new Error("Instagram requires an image or video");

  if (
    (post.kind === "image" || isStory) &&
    media.length === 1 &&
    media[0]!.kind !== "video"
  ) {
    const url = mediaUrl(media[0]!);
    const creationId = await createContainer({
      image_url: url,
      caption: body,
      ...(isStory ? { media_type: "STORIES" } : {}),
      ...(target.platformSettings?.altText
        ? { alt_text: target.platformSettings.altText }
        : {}),
    });
    await saveAttempt?.({ kind: "instagram", creationId });
    return finishContainer(creationId);
  }

  if (post.kind === "image" && media.length > 1) {
    const childIds: string[] = [];
    for (const m of media) {
      const url = mediaUrl(m);
      const cid = await createContainer({
        image_url: url,
        is_carousel_item: "true",
      });
      childIds.push(cid);
    }
    await Promise.all(childIds.map((childId) => waitForContainer(childId)));
    const creationId = await createContainer({
      caption: body,
      media_type: "CAROUSEL",
      children: childIds.join(","),
    });
    await saveAttempt?.({ kind: "instagram", creationId, childIds });
    return finishContainer(creationId);
  }

  if (
    post.kind === "video" ||
    isReel ||
    (isStory && media[0]?.kind === "video")
  ) {
    const m = media[0];
    if (!m) throw new Error("Video missing");
    const url = mediaUrl(m);
    const creationId = await createContainer({
      video_url: url,
      caption: body,
      media_type: isStory ? "STORIES" : "REELS",
      ...(!isStory && isReel && target.platformSettings?.shareToFeed === false
        ? { share_to_feed: "false" }
        : {}),
    });
    await saveAttempt?.({ kind: "instagram", creationId });
    return finishContainer(creationId);
  }

  throw new Error(`Instagram: unsupported kind ${post.kind}`);
}

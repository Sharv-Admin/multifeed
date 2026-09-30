"use client";

import { api } from "@convex/_generated/api";
import {
  ArrowUpRight,
  Calendar,
  Copy,
  Edit,
  File,
  Integration,
  MoreHorizontal,
  Repeat,
  Trash,
} from "@honeyicons/react";
import type { FunctionReturnType } from "convex/server";
import { format } from "date-fns";
import type { CSSProperties, ReactNode } from "react";
import { POST_FORMATS } from "@/components/posts/post-composer-config";
import { Badge } from "@multifeed/ui/components/badge";
import { Button } from "@multifeed/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@multifeed/ui/components/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@multifeed/ui/components/table";
import {
  PLATFORM_META,
  platformBrand,
  platformForeground,
  platformLabel,
} from "@/lib/platform-meta";
import { cn } from "@multifeed/ui/lib/utils";

export type PostListItem = FunctionReturnType<typeof api.posts.list>[number];

const STATUS_BADGE: Record<
  string,
  "default" | "secondary" | "destructive" | "outline" | "success"
> = {
  draft: "secondary",
  scheduled: "success",
  publishing: "outline",
  published: "secondary",
  failed: "destructive",
};

export function PostsTableHead() {
  return (
    <TableHeader>
      <TableRow>
        <TableHead className="w-[36%]">Post</TableHead>
        <TableHead className="w-[20%]">Accounts</TableHead>
        <TableHead className="w-[12%]">Open</TableHead>
        <TableHead className="w-[12%]">Status</TableHead>
        <TableHead className="w-[14%]">Date</TableHead>
        <TableHead className="w-14">
          <span className="sr-only">Actions</span>
        </TableHead>
      </TableRow>
    </TableHeader>
  );
}

export function PostsTable({
  deletingId,
  emptyAction,
  emptyMessage,
  onDelete,
  onEdit,
  onRetry,
  onViewCalendar,
  posts,
  retryingId,
}: {
  deletingId: string | null;
  emptyAction?: ReactNode;
  emptyMessage: string;
  onDelete: (postId: PostListItem["_id"]) => void;
  onEdit: (postId: PostListItem["_id"], isDraft: boolean) => void;
  onRetry: (postId: PostListItem["_id"]) => void;
  onViewCalendar: (postId: PostListItem["_id"]) => void;
  posts: PostListItem[];
  retryingId: string | null;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border-4 border-card">
      <Table className="min-w-[880px] table-fixed">
        <PostsTableHead />
        <TableBody>
          {posts.length === 0 ? (
            <TableRow data-static>
              <TableCell colSpan={6}>
                <div className="flex flex-col items-center gap-3 py-8 text-center whitespace-normal text-muted-foreground">
                  <p>{emptyMessage}</p>
                  {emptyAction}
                </div>
              </TableCell>
            </TableRow>
          ) : (
            posts.map((post) => (
              <PostTableRow
                deleting={deletingId === post._id}
                key={post._id}
                onDelete={() => onDelete(post._id)}
                onEdit={() => onEdit(post._id, post.status === "draft")}
                onRetry={() => onRetry(post._id)}
                onViewCalendar={() => onViewCalendar(post._id)}
                post={post}
                retrying={retryingId === post._id}
              />
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function PostTableRow({
  deleting,
  onDelete,
  onEdit,
  onRetry,
  onViewCalendar,
  post,
  retrying,
}: {
  deleting: boolean;
  onDelete: () => void;
  onEdit: () => void;
  onRetry: () => void;
  onViewCalendar: () => void;
  post: PostListItem;
  retrying: boolean;
}) {
  const canRetry = post.targets.some((target) => target.status === "failed");
  const permalinks = post.targets.filter((target) => target.platformPermalink);
  const FormatIcon =
    POST_FORMATS.find((format) => format.id === post.kind)?.icon ?? File;

  return (
    <TableRow>
      <TableCell>
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
          >
            <FormatIcon size={18} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              {post.title || "Untitled post"}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {post.body || "No caption"}
            </p>
          </div>
        </div>
      </TableCell>
      <TableCell>
        {post.targets.length === 0 ? (
          <span className="text-sm text-muted-foreground">
            No accounts selected
          </span>
        ) : (
          <div className="flex flex-col gap-2 whitespace-normal">
            {post.targets.map((target) => {
              const PlatformIcon =
                PLATFORM_META[target.platform]?.icon ?? Integration;
              return (
                <span
                  className="flex max-w-full flex-col gap-1"
                  key={target.targetId}
                >
                  <span className="inline-flex min-w-0 items-center gap-2 text-sm">
                    <span
                      className="flex size-5 shrink-0 items-center justify-center rounded-md bg-(--brand) text-(--brand-fg)"
                      style={
                        {
                          "--brand": platformBrand(target.platform),
                          "--brand-fg": platformForeground(target.platform),
                        } as CSSProperties
                      }
                    >
                      <PlatformIcon size={13} />
                    </span>
                    <span className="sr-only">
                      {platformLabel(target.platform)}{" "}
                    </span>
                    <span className="truncate">
                      {target.username
                        ? `@${target.username}`
                        : platformLabel(target.platform)}
                    </span>
                    {target.hasCustomCaption && (
                      <Edit aria-label="Custom caption" size={11} />
                    )}
                  </span>
                  {target.failureMessage && (
                    <span className="break-words text-xs text-destructive">
                      {target.failureMessage}
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        )}
      </TableCell>
      <TableCell>
        <OpenPostButton permalinks={permalinks} />
      </TableCell>
      <TableCell>
        <Badge variant={STATUS_BADGE[post.status] ?? "secondary"}>
          <span
            className={cn(
              "size-1.5 rounded-full bg-current",
              post.status === "publishing" && "motion-safe:animate-pulse",
            )}
          />
          <span className="capitalize">
            {post.status === "published" ? "Posted" : post.status}
          </span>
        </Badge>
      </TableCell>
      <TableCell>
        <p className="text-sm font-medium text-foreground">
          {format(new Date(post.scheduledFor ?? post.createdAt), "MMM d, yyyy")}
        </p>
        <p className="text-xs text-muted-foreground">
          {post.scheduledFor
            ? format(new Date(post.scheduledFor), "h:mm a")
            : "Created"}
        </p>
      </TableCell>
      <TableCell>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                aria-label={`Actions for ${post.title || "untitled post"}`}
                size="icon-sm"
                variant="ghost"
              />
            }
          >
            <MoreHorizontal size={18} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuGroup>
              {post.scheduledFor && post.status !== "draft" && (
                <DropdownMenuItem onClick={onViewCalendar}>
                  <Calendar size={15} />
                  View in calendar
                </DropdownMenuItem>
              )}
              {canRetry && (
                <DropdownMenuItem disabled={retrying} onClick={onRetry}>
                  <Repeat size={15} />
                  {retrying ? "Retrying…" : "Retry delivery"}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={onEdit}>
                {post.status === "draft" ? (
                  <Edit size={15} />
                ) : (
                  <Copy size={15} />
                )}
                {post.status === "draft" ? "Continue" : "Duplicate"}
              </DropdownMenuItem>
              {post.status !== "publishing" && (
                <DropdownMenuItem
                  disabled={deleting}
                  onClick={onDelete}
                  variant="destructive"
                >
                  <Trash size={15} />
                  {deleting ? "Deleting…" : "Delete post"}
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}

function OpenPostButton({
  permalinks,
}: {
  permalinks: PostListItem["targets"];
}) {
  if (permalinks.length === 0) return null;

  if (permalinks.length === 1) {
    const target = permalinks[0]!;
    return (
      <Button
        nativeButton={false}
        render={
          <a href={target.platformPermalink} rel="noreferrer" target="_blank" />
        }
        size="xs"
        variant="outline"
      >
        Open
        <ArrowUpRight data-icon="inline-end" />
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button size="xs" variant="outline" />}>
        Open
        <ArrowUpRight data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuGroup>
          {permalinks.map((target) => (
            <DropdownMenuItem
              key={target.targetId}
              nativeButton={false}
              render={
                <a
                  href={target.platformPermalink}
                  rel="noreferrer"
                  target="_blank"
                />
              }
            >
              Open on {platformLabel(target.platform)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Add } from "@honeyicons/react";
import Link from "next/link";
import { PlatformConnectionCard } from "@/components/connections/PlatformConnectionCard";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ConnectionUsageMeter } from "@/components/connections/ConnectionUsageMeter";
import { DashboardLoadingSkeleton } from "@/components/layout/DashboardLoadingSkeleton";
import { DashboardPageTitle } from "@/components/layout/DashboardPageTitle";
import { Button } from "@multifeed/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@multifeed/ui/components/dialog";
import { Spinner } from "@multifeed/ui/components/spinner";
import { oauthErrorMessage } from "@/lib/oauth/env";
import { accountNeedsReconnect } from "@/lib/oauth/required-scopes";
import {
  CONNECTABLE_PLATFORMS,
  type OAuthPlatform,
  PLATFORM_META,
} from "@/lib/platform-meta";
import { useCurrentTimeBucket } from "@/lib/use-current-time-bucket";

function ConnectionsPageInner() {
  const nowMs = useCurrentTimeBucket();
  const pageData = useQuery(api.oauth.accounts.getConnectionsPageData, {
    nowMs,
  });
  const disconnect = useMutation(api.oauth.accounts.disconnect);
  const searchParams = useSearchParams();

  const [connecting, setConnecting] = useState<OAuthPlatform | null>(null);
  // Synchronous in-flight guard: state updates are batched, so a fast
  // double-click could otherwise start the OAuth flow twice.
  const connectingRef = useRef(false);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [accountToDisconnect, setAccountToDisconnect] = useState<{
    id: Id<"connectedAccounts">;
    username: string;
  } | null>(null);
  const handledFlash = useRef("");
  const connected = searchParams.get("connected") ?? "";
  const oauthError = searchParams.get("error") ?? "";
  const skipped = searchParams.get("skipped") ?? "";
  const flashKey = `${connected}\0${oauthError}\0${skipped}`;
  const accounts = pageData?.accounts;
  const entitlements = pageData?.entitlements;
  const connectedAccountsCount = (accounts ?? []).filter(
    (account) => account.status !== "revoked",
  ).length;

  useEffect(() => {
    if (!connected && !oauthError && !skipped) return;

    if (handledFlash.current !== flashKey) {
      handledFlash.current = flashKey;
      if (connected) {
        const label = PLATFORM_META[connected]?.label ?? "Account";
        const skippedCount = Number.parseInt(skipped, 10);
        if (Number.isFinite(skippedCount) && skippedCount > 0) {
          toast.warning(
            `${label} connected. ${skippedCount} more account${
              skippedCount === 1 ? " was" : "s were"
            } skipped because your plan limit was reached. Upgrade to connect them.`,
          );
        } else {
          toast.success(`${label} connected successfully.`);
        }
      } else if (oauthError) {
        toast.error(oauthErrorMessage(oauthError));
      }
    }

    window.history.replaceState(null, "", "/connections");
  }, [connected, flashKey, oauthError, skipped]);

  if (!accounts || !entitlements) {
    return <DashboardLoadingSkeleton variant="connections" />;
  }

  const accountLimit = entitlements.connectedAccountLimit;
  const atLimit = connectedAccountsCount >= accountLimit;

  const byPlatform = new Map<string, typeof accounts>();
  for (const platform of CONNECTABLE_PLATFORMS) {
    byPlatform.set(platform, []);
  }
  for (const account of accounts) {
    const list = byPlatform.get(account.platform) ?? [];
    list.push(account);
    byPlatform.set(account.platform, list);
  }
  const platformPriority = (platform: OAuthPlatform) => {
    const linked = byPlatform.get(platform) ?? [];
    if (linked.some(accountNeedsReconnect)) return 2;
    return linked.length > 0 ? 1 : 0;
  };
  const orderedPlatforms = [...CONNECTABLE_PLATFORMS].sort(
    (left, right) => platformPriority(right) - platformPriority(left),
  );

  const onConnect = (platform: OAuthPlatform) => {
    if (connecting !== null || connectingRef.current) return;
    connectingRef.current = true;
    setConnecting(platform);
    void fetch("/api/oauth/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform, returnTo: "/connections" }),
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          url?: string;
          error?: string;
        };
        if (!response.ok || !payload.url) {
          throw new Error(
            payload.error ?? "Could not connect this account. Try again.",
          );
        }
        window.location.assign(payload.url);
      })
      .catch((err) => {
        connectingRef.current = false;
        setConnecting(null);
        toast.error(
          err instanceof Error ? err.message : "Could not start OAuth",
        );
      });
  };

  const onDisconnect = (accountId: Id<"connectedAccounts">) => {
    setDisconnecting(accountId);
    void disconnect({ accountId })
      .then(() => {
        setAccountToDisconnect(null);
        toast.success("Account disconnected.");
      })
      .catch((err) => {
        toast.error(
          err instanceof Error ? err.message : "Could not disconnect account",
        );
      })
      .finally(() => setDisconnecting(null));
  };

  return (
    <>
      <div className="flex flex-col gap-6">
        <DashboardPageTitle
          title="Connections"
          description="Connect your accounts, check their status, and renew access when needed."
          actions={
            accounts.some((account) => !accountNeedsReconnect(account)) ? (
              <Button nativeButton={false} render={<Link href="/posts/new" />}>
                <Add data-icon="inline-start" />
                New post
              </Button>
            ) : undefined
          }
        />

        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
          <ConnectionUsageMeter
            used={connectedAccountsCount}
            limit={accountLimit}
          />
          <section
            aria-label="Social platforms"
            className="flex min-w-0 flex-1 flex-col gap-4 lg:order-first"
          >
            {orderedPlatforms.map((platform) => (
              <PlatformConnectionCard
                key={platform}
                platform={platform}
                accounts={byPlatform.get(platform) ?? []}
                atLimit={atLimit}
                connecting={connecting}
                disconnecting={disconnecting}
                onConnect={onConnect}
                onDisconnect={setAccountToDisconnect}
              />
            ))}
          </section>
        </div>
      </div>

      <Dialog
        open={accountToDisconnect !== null}
        onOpenChange={(open) => {
          if (!open && disconnecting === null) setAccountToDisconnect(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect account?</DialogTitle>
            <DialogDescription>
              Disconnect @{accountToDisconnect?.username}? You can reconnect it
              anytime.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={disconnecting !== null}
              onClick={() => setAccountToDisconnect(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={disconnecting !== null}
              onClick={() => {
                if (accountToDisconnect) {
                  void onDisconnect(accountToDisconnect.id);
                }
              }}
            >
              {disconnecting !== null && <Spinner data-icon="inline-start" />}
              {disconnecting !== null ? "Disconnecting…" : "Disconnect"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ConnectionsPage() {
  return (
    <Suspense fallback={<DashboardLoadingSkeleton variant="connections" />}>
      <ConnectionsPageInner />
    </Suspense>
  );
}

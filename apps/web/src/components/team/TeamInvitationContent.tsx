"use client";

import { useHexclaveApp } from "@hexclave/next";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@multifeed/ui/components/button";
import { Spinner } from "@multifeed/ui/components/spinner";
import {
  acceptAndSelectInvitedTeam,
  invitationErrorMessage,
} from "@/lib/accept-team-invitation";

type Workspace = { id: string; displayName: string };

export function TeamInvitationContent({ code }: { code: string }) {
  const app = useHexclaveApp();
  const user = app.useUser({ includeRestricted: true });
  const [teamName, setTeamName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const pending = useRef(false);

  useEffect(() => {
    if (!code || !user || user.isRestricted) return;
    let cancelled = false;
    void Promise.all([
      app.verifyTeamInvitationCode(code),
      app.getTeamInvitationDetails(code),
    ])
      .then(([verification, details]) => {
        if (cancelled) return;
        if (verification.status === "error") {
          setError(invitationErrorMessage(verification.error.errorCode));
        } else if (details.status === "error") {
          setError(invitationErrorMessage(details.error.errorCode));
        } else {
          setTeamName(details.data.teamDisplayName);
        }
      })
      .catch(() => {
        if (!cancelled)
          setError(
            "Could not load the invitation. Please reopen this link to try again.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [app, code, user]);

  const openWorkspace = async (teamId: string) => {
    if (!user || pending.current) return;
    pending.current = true;
    setIsLoading(true);
    setError(null);
    try {
      // User-scoped lookup checks membership before changing workspace.
      const team = await user.getTeam(teamId);
      if (!team) throw new Error("Workspace membership unavailable");
      await user.setSelectedTeam(team.id);
      // A full navigation drops client query caches from the old workspace.
      window.location.replace("/overview");
    } catch {
      setError("Could not open this workspace. Please try again.");
      pending.current = false;
      setIsLoading(false);
    }
  };

  const acceptInvitation = async () => {
    if (!user || !teamName || pending.current) return;
    pending.current = true;
    setIsLoading(true);
    setError(null);
    try {
      const result = await acceptAndSelectInvitedTeam(app, user, code);
      if (result.status === "error") {
        setError(invitationErrorMessage(result.error.errorCode));
        return;
      }
      setAccepted(true);
      if (result.selected) {
        window.location.replace("/overview");
        return;
      }
      setWorkspaces(await user.listTeams());
    } catch {
      setError(
        "Could not finish this request. Please reopen the invitation to check its status.",
      );
    } finally {
      pending.current = false;
      setIsLoading(false);
    }
  };

  return (
    <section className="w-full max-w-md space-y-6 rounded-2xl border border-border bg-background p-6 sm:p-8">
      <div className="space-y-2">
        <h1 className="font-display text-2xl font-bold tracking-tight">
          {accepted ? "Invitation accepted" : "Join your team"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {accepted
            ? "You have joined the team. Choose a workspace to continue."
            : "Use your existing MultiFeed account, or sign up with the invited email. Your existing workspace and data stay unchanged."}
        </p>
      </div>
      {!code ? (
        <p role="alert" className="text-sm">
          {invitationErrorMessage("VERIFICATION_CODE_NOT_FOUND")}
        </p>
      ) : !user ? (
        <Button className="w-full" onClick={() => void app.redirectToSignIn()}>
          Sign in to accept invitation
        </Button>
      ) : user.isRestricted ? (
        <Button
          className="w-full"
          onClick={() => void app.redirectToOnboarding()}
        >
          Complete account setup
        </Button>
      ) : accepted ? (
        <div className="flex flex-col gap-3">
          {workspaces.map((workspace) => (
            <Button
              key={workspace.id}
              disabled={isLoading}
              variant="outline"
              onClick={() => void openWorkspace(workspace.id)}
            >
              {workspace.displayName}
            </Button>
          ))}
        </div>
      ) : teamName ? (
        <div className="space-y-4">
          <p className="text-sm">
            You’re invited to join <strong>{teamName}</strong>.
          </p>
          <p className="break-all text-sm text-muted-foreground">
            Signed in as {user.primaryEmail}
          </p>
          <Button
            className="w-full"
            disabled={isLoading}
            onClick={() => void acceptInvitation()}
          >
            {isLoading ? <Spinner className="size-4" /> : null}
            {isLoading ? "Joining..." : "Accept invitation"}
          </Button>
        </div>
      ) : !error ? (
        <p role="status" className="text-sm text-muted-foreground">
          Checking invitation...
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Link
        className="block text-sm underline underline-offset-4"
        href="/overview"
      >
        Go to dashboard
      </Link>
    </section>
  );
}

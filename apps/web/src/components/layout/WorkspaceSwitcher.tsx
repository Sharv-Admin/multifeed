"use client";

import { Check } from "@honeyicons/react";
import { useEffect, useRef, useState } from "react";
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@multifeed/ui/components/dropdown-menu";
import { hexclaveClientApp } from "@/hexclave/client";
import { selectVerifiedWorkspace } from "@/lib/select-verified-workspace";

type Workspace = { id: string; displayName: string };

// Call from the persistent profile parent, never from the dismissible popup.
export function useWorkspaceSwitcher() {
  const user = hexclaveClientApp.useUser();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const pending = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setWorkspaces([]);
    if (!user) {
      setLoading(false);
      return;
    }
    void user
      .listTeams()
      .then((teams) => {
        if (!cancelled) setWorkspaces(teams);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load your workspaces. Try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, reload]);

  const select = async (teamId: string) => {
    if (!user || pending.current || teamId === user.selectedTeam?.id) return;
    pending.current = true;
    setSwitching(true);
    setError(null);
    try {
      await selectVerifiedWorkspace(user, teamId);
      // Drop every old-workspace client cache rather than rendering mixed data.
      window.location.replace("/overview");
    } catch {
      setError("Could not switch workspace. Please try again.");
      pending.current = false;
      setSwitching(false);
    }
  };

  return {
    workspaces,
    loading,
    switching,
    error,
    currentTeamId: user?.selectedTeam?.id,
    select,
    reloadWorkspaces: () => setReload((value) => value + 1),
  };
}

export function WorkspaceSwitcher({
  state,
}: {
  state: ReturnType<typeof useWorkspaceSwitcher>;
}) {
  const {
    workspaces,
    loading,
    switching,
    error,
    currentTeamId,
    select,
    reloadWorkspaces,
  } = state;

  return (
    <DropdownMenuGroup aria-label="Workspaces">
      <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
      {loading ? (
        <p role="status" className="px-2 py-1.5 text-sm text-muted-foreground">
          Loading workspaces...
        </p>
      ) : null}
      {workspaces.map((workspace) => {
        const current = workspace.id === currentTeamId;
        return (
          <DropdownMenuItem
            key={workspace.id}
            closeOnClick={false}
            disabled={switching || current}
            title={workspace.displayName}
            onClick={() => void select(workspace.id)}
          >
            <span className="min-w-0 flex-1 truncate">
              {workspace.displayName}
            </span>
            {current ? (
              <>
                <span className="text-xs text-muted-foreground">Current</span>
                <Check size={16} />
              </>
            ) : null}
          </DropdownMenuItem>
        );
      })}
      {switching ? (
        <p role="status" className="px-2 py-1.5 text-sm text-muted-foreground">
          Opening workspace...
        </p>
      ) : null}
      {!loading && !error && workspaces.length === 0 ? (
        <p className="px-2 py-1.5 text-sm text-muted-foreground">
          No workspaces available.
        </p>
      ) : null}
      {error ? (
        <>
          <p role="alert" className="px-2 py-1.5 text-sm text-destructive">
            {error}
          </p>
          {workspaces.length === 0 ? (
            <DropdownMenuItem
              closeOnClick={false}
              disabled={loading}
              onClick={reloadWorkspaces}
            >
              Reload workspaces
            </DropdownMenuItem>
          ) : null}
        </>
      ) : null}
    </DropdownMenuGroup>
  );
}

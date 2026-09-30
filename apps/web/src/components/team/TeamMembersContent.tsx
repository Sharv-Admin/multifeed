"use client";

import { api } from "@convex/_generated/api";
import type { CurrentUser, Team } from "@hexclave/next";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { Suspense } from "react";
import { DashboardPageTitle } from "@/components/layout/DashboardPageTitle";
import { InviteModal } from "@/components/team/InviteModal";
import { TeamMembersTable } from "@/components/team/TeamMembersTable";
import { InviteMemberFallback } from "@/components/team/TeamPageSkeleton";
import { TeamStats, TeamStatsSkeleton } from "@/components/team/TeamStats";
import { TeamTableSkeleton } from "@/components/team/TeamTableSkeleton";
import { useCurrentTimeBucket } from "@/lib/use-current-time-bucket";

type TeamTableRow = {
  email: string | null;
  id: string;
  imageUrl: string | null;
  lastActivity: string;
  name: string | null;
  status: "Active" | "Invited";
  subtitle: string;
};

const dateFormatter = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export type { TeamTableRow };

export function TeamMembersContent({
  team,
  user,
}: {
  team: Team;
  user: CurrentUser;
}) {
  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <DashboardPageTitle
        title="Manage team"
        description={`Manage who can work inside ${team.displayName}.`}
        actions={
          <Suspense fallback={<InviteMemberFallback />}>
            <TeamInviteAction team={team} user={user} />
          </Suspense>
        }
      />
      <Suspense
        fallback={
          <div className="flex flex-col gap-6" aria-busy="true" role="status">
            <span className="sr-only">Loading team members</span>
            <TeamStatsSkeleton />
            <TeamTableSkeleton />
          </div>
        }
      >
        <TeamMembersData team={team} user={user} />
      </Suspense>
    </div>
  );
}

function TeamInviteAction({ team, user }: { team: Team; user: CurrentUser }) {
  const canInviteMembers = user.usePermission(team, "$invite_members") != null;
  const members = team.useUsers();
  const invitations = team.useInvitations();
  const nowMs = useCurrentTimeBucket();
  const entitlements = useQuery(api.billing.getEntitlements, { nowMs });

  if (!canInviteMembers) return null;

  return (
    <InviteModal
      invitationsCount={invitations.length}
      membersCount={members.length}
      team={team}
      teamSeatLimit={entitlements?.teamSeatLimit}
    />
  );
}

function TeamMembersData({ team, user }: { team: Team; user: CurrentUser }) {
  const canReadMembers = user.usePermission(team, "$read_members") != null;
  const members = team.useUsers();
  const invitations = team.useInvitations();
  const nowMs = useCurrentTimeBucket();
  const entitlements = useQuery(api.billing.getEntitlements, { nowMs });

  if (!canReadMembers) {
    return (
      <div className="rounded-4xl border border-border bg-background/40 p-5 text-sm text-muted-foreground">
        You do not have permission to read team members.
      </div>
    );
  }

  const rows: TeamTableRow[] = [
    ...members.map((member) => {
      const isCurrentUser = member.id === user.id;
      return {
        email: isCurrentUser ? user.primaryEmail : null,
        id: member.id,
        imageUrl:
          member.teamProfile.profileImageUrl ??
          (isCurrentUser ? user.profileImageUrl : null),
        lastActivity: "—",
        name:
          member.teamProfile.displayName ??
          (isCurrentUser ? user.displayName : null),
        status: "Active" as const,
        subtitle: "Team member",
      };
    }),
    ...invitations.map((invitation) => ({
      email: invitation.recipientEmail,
      id: invitation.id,
      imageUrl: null,
      lastActivity: `Expires ${dateFormatter.format(invitation.expiresAt)}`,
      name: "Pending invite",
      status: "Invited" as const,
      subtitle: "Awaiting response",
    })),
  ];

  return (
    <>
      <TeamStats
        invitationsCount={invitations.length}
        membersCount={members.length}
        teamSeatLimit={entitlements?.teamSeatLimit}
      />
      <TeamMembersTable rows={rows} />
    </>
  );
}

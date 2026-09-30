type Invitation = { id: string; teamId: string };
type InvitationUser = {
  listTeamInvitations(): Promise<Invitation[]>;
  getTeam(id: string): Promise<{ id: string } | null>;
  setSelectedTeam(id: string): Promise<void>;
};
type InvitationApp = {
  acceptTeamInvitation(
    code: string,
  ): Promise<
    { status: "ok" } | { status: "error"; error: { errorCode: string } }
  >;
};

export async function acceptAndSelectInvitedTeam(
  app: InvitationApp,
  user: InvitationUser,
  code: string,
) {
  const before = await user.listTeamInvitations();
  // Hexclave checks the code and the signed-in user's verified email. Never
  // join by a team name or an untrusted team ID from the URL.
  const result = await app.acceptTeamInvitation(code);
  if (result.status === "error") return result;

  try {
    // These SDK list/get methods refetch, rather than reading the hook cache.
    const after = await user.listTeamInvitations();
    const remaining = new Set(after.map((invitation) => invitation.id));
    const consumed = before.filter(
      (invitation) => !remaining.has(invitation.id),
    );
    // If concurrent invitation changes make the destination ambiguous, ask
    // the user to choose from their verified memberships instead of guessing.
    if (consumed.length === 1) {
      const team = await user.getTeam(consumed[0]!.teamId);
      if (team) {
        await user.setSelectedTeam(team.id);
        return { status: "ok" as const, selected: true };
      }
    }
  } catch {
    // Acceptance has already succeeded. Do not retry a now-consumed code
    // or misreport a workspace-selection failure as a failed invitation.
  }

  return { status: "ok" as const, selected: false };
}

export function invitationErrorMessage(errorCode: string) {
  switch (errorCode) {
    case "TEAM_INVITATION_EMAIL_MISMATCH":
      return "This invitation belongs to a different email address. Sign in with the invited email, then reopen the invitation.";
    case "VERIFICATION_CODE_EXPIRED":
      return "This invitation has expired. Ask the team owner to send a new invitation.";
    case "VERIFICATION_CODE_ALREADY_USED":
      return "This invitation has already been accepted. Open your dashboard to access your workspaces.";
    case "VERIFICATION_CODE_NOT_FOUND":
      return "This invitation link is invalid. Please reopen the original email or ask for a new invitation.";
    default:
      return "We could not check this invitation. Please try again.";
  }
}

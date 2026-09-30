export type WorkspaceSelectionUser = {
  getTeam(id: string): Promise<{ id: string } | null>;
  setSelectedTeam(id: string): Promise<void>;
};

/** Select only a membership reverified by the signed-in user's SDK. */
export async function selectVerifiedWorkspace(
  user: WorkspaceSelectionUser,
  teamId: string,
): Promise<void> {
  const team = await user.getTeam(teamId);
  if (!team || team.id !== teamId) {
    throw new Error("Workspace membership unavailable");
  }
  await user.setSelectedTeam(team.id);
}

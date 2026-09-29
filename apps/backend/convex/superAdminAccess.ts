type AuthenticatedUser = {
  id: string;
  email?: string;
  emailVerified: boolean;
  selectedTeamId: string;
  isAnonymous: boolean;
  isRestricted: boolean;
};

type OwnerAccessConfig = {
  MULTIFEED_SUPER_ADMIN_USER_ID?: string;
  MULTIFEED_SUPER_ADMIN_TEAM_ID?: string;
  MULTIFEED_SUPER_ADMIN_EMAIL?: string;
};

/**
 * Complimentary product access only, not global data/admin permissions.
 * Call only after requireUser validates the signed Hexclave identity.
 * All three server-only settings must match; removing any one revokes access.
 */
export function hasSuperAdminAccess(
  user: AuthenticatedUser,
  teamId: string,
  config: OwnerAccessConfig = {
    MULTIFEED_SUPER_ADMIN_USER_ID: process.env.MULTIFEED_SUPER_ADMIN_USER_ID,
    MULTIFEED_SUPER_ADMIN_TEAM_ID: process.env.MULTIFEED_SUPER_ADMIN_TEAM_ID,
    MULTIFEED_SUPER_ADMIN_EMAIL: process.env.MULTIFEED_SUPER_ADMIN_EMAIL,
  },
): boolean {
  const userId = config.MULTIFEED_SUPER_ADMIN_USER_ID?.trim();
  const ownerTeamId = config.MULTIFEED_SUPER_ADMIN_TEAM_ID?.trim();
  const email = config.MULTIFEED_SUPER_ADMIN_EMAIL?.trim().toLowerCase();

  return Boolean(
    userId &&
    ownerTeamId &&
    email &&
    user.emailVerified &&
    !user.isAnonymous &&
    !user.isRestricted &&
    user.id === userId &&
    user.selectedTeamId === ownerTeamId &&
    teamId === ownerTeamId &&
    user.email?.trim().toLowerCase() === email,
  );
}

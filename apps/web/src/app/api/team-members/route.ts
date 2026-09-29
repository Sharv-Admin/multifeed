import { api } from "@convex/_generated/api";
import type { ServerTeam } from "@hexclave/next";
import { fetchQuery } from "convex/nextjs";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  getHexclaveConvexServerToken,
  hexclaveServerApp,
} from "@/hexclave/server";
import { appOrigin, assertSameOrigin } from "@/lib/oauth/env";
import { countUsedTeamSeats } from "@/lib/team-seats";
import { currentTimeBucket } from "@/lib/time-bucket";

const responseOptions = {
  headers: { "Cache-Control": "private, no-store" },
};

const errorResponse = (error: string, status: number) =>
  NextResponse.json({ error }, { status, ...responseOptions });

const isEmail = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= 320 &&
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
  } catch {
    return errorResponse("Invalid request origin", 403);
  }

  const auth = await Promise.all([
    hexclaveServerApp.getUser({ tokenStore: request }),
    getHexclaveConvexServerToken(request),
  ]).catch((error) => {
    console.error(
      "[team-members/auth]",
      error instanceof Error ? error.message : error,
    );
    return null;
  });

  if (!auth) {
    return errorResponse("Unauthorized", 401);
  }

  const [user, token] = auth;
  const team = (user?.selectedTeam as ServerTeam | null | undefined) ?? null;

  if (!user || !token) {
    return errorResponse("Unauthorized", 401);
  }

  if (!team) {
    return errorResponse("No selected team", 400);
  }

  const payload: unknown = await request.json().catch(() => null);
  const email =
    typeof payload === "object" &&
    payload !== null &&
    "email" in payload &&
    typeof payload.email === "string"
      ? payload.email.trim()
      : null;

  if (!isEmail(email)) {
    return errorResponse("Enter a valid email address", 400);
  }

  const [canInviteMembers, entitlements] = await Promise.all([
    user.hasPermission(team, "$invite_members"),
    fetchQuery(
      api.billing.getEntitlements,
      { nowMs: currentTimeBucket() },
      { token },
    ),
  ]);

  if (!canInviteMembers) {
    return errorResponse(
      "You do not have permission to invite team members",
      403,
    );
  }

  const [members, invitations] = await Promise.all([
    team.listUsers(),
    team.listInvitations(),
  ]);
  const usedSeats = countUsedTeamSeats(members.length, invitations.length);

  if (usedSeats >= entitlements.teamSeatLimit) {
    return errorResponse(
      `Team seat limit reached (${usedSeats}/${entitlements.teamSeatLimit}). Upgrade your plan to invite more members.`,
      409,
    );
  }

  try {
    await team.inviteUser({
      email,
      // Server-side invitations cannot resolve a relative URL from a browser.
      // Use the configured app origin, never an untrusted request Host header.
      callbackUrl: new URL(
        hexclaveServerApp.urls.teamInvitation,
        appOrigin(),
      ).toString(),
    });
    return NextResponse.json({ ok: true }, { status: 201, ...responseOptions });
  } catch (error) {
    console.error(
      "[team-members/invite]",
      error instanceof Error ? error.message : error,
    );
    return errorResponse("Could not send team invitation", 502);
  }
}

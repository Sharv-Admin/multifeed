import assert from "node:assert/strict";
import test from "node:test";
import { selectVerifiedWorkspace } from "./src/lib/select-verified-workspace.ts";
import { acceptAndSelectInvitedTeam } from "./src/lib/accept-team-invitation.ts";

test("missing or mismatched verified membership never selects a workspace", async () => {
  for (const team of [null, { id: "different-team" }]) {
    const selections: string[] = [];
    await assert.rejects(
      selectVerifiedWorkspace(
        {
          getTeam: async () => team,
          setSelectedTeam: async (id) => {
            selections.push(id);
          },
        },
        "invited-team",
      ),
    );
    assert.deepEqual(selections, []);
  }
});

test("verified membership selects exactly its ID", async () => {
  const selections: string[] = [];
  await selectVerifiedWorkspace(
    {
      getTeam: async (id) => ({ id }),
      setSelectedTeam: async (id) => {
        selections.push(id);
      },
    },
    "invited-team",
  );
  assert.deepEqual(selections, ["invited-team"]);
});

test("lookup or selection failures propagate for recoverable UI handling", async () => {
  await assert.rejects(
    selectVerifiedWorkspace(
      {
        getTeam: async () => {
          throw new Error("lookup failed");
        },
        setSelectedTeam: async () => {
          assert.fail("must not select");
        },
      },
      "team",
    ),
    /lookup failed/,
  );
  await assert.rejects(
    selectVerifiedWorkspace(
      {
        getTeam: async (id) => ({ id }),
        setSelectedTeam: async () => {
          throw new Error("selection failed");
        },
      },
      "team",
    ),
    /selection failed/,
  );
});

function invitationFixture(
  after: Array<{ id: string; teamId: string }>,
  selectionFails = false,
) {
  let lists = 0;
  let accepts = 0;
  const selections: string[] = [];
  const before = [
    { id: "invite-1", teamId: "team-1" },
    { id: "invite-2", teamId: "team-2" },
  ];
  const user = {
    listTeamInvitations: async () => (++lists === 1 ? before : after),
    getTeam: async (id: string) => ({ id }),
    setSelectedTeam: async (id: string) => {
      if (selectionFails) throw new Error("temporary failure");
      selections.push(id);
    },
  };
  const app = {
    acceptTeamInvitation: async () => {
      accepts++;
      return { status: "ok" as const };
    },
  };
  return { app, user, selections, acceptedCount: () => accepts };
}

test("existing user selects only the single consumed invitation's team", async () => {
  const fixture = invitationFixture([{ id: "invite-2", teamId: "team-2" }]);
  assert.deepEqual(
    await acceptAndSelectInvitedTeam(fixture.app, fixture.user, "dummy-code"),
    { status: "ok", selected: true },
  );
  assert.deepEqual(fixture.selections, ["team-1"]);
  assert.equal(fixture.acceptedCount(), 1);
});

test("ambiguous consumption does not guess a workspace", async () => {
  const fixture = invitationFixture([]);
  assert.deepEqual(
    await acceptAndSelectInvitedTeam(fixture.app, fixture.user, "dummy-code"),
    { status: "ok", selected: false },
  );
  assert.deepEqual(fixture.selections, []);
  assert.equal(fixture.acceptedCount(), 1);
});

test("selection failure preserves successful acceptance without accepting twice", async () => {
  const fixture = invitationFixture(
    [{ id: "invite-2", teamId: "team-2" }],
    true,
  );
  assert.deepEqual(
    await acceptAndSelectInvitedTeam(fixture.app, fixture.user, "dummy-code"),
    { status: "ok", selected: false },
  );
  assert.deepEqual(fixture.selections, []);
  assert.equal(fixture.acceptedCount(), 1);
});

test("email mismatch does not select a team or refetch invitations", async () => {
  const fixture = invitationFixture([]);
  const error = {
    status: "error" as const,
    error: { errorCode: "TEAM_INVITATION_EMAIL_MISMATCH" },
  };
  assert.equal(
    await acceptAndSelectInvitedTeam(
      { acceptTeamInvitation: async () => error },
      fixture.user,
      "dummy-code",
    ),
    error,
  );
  assert.deepEqual(fixture.selections, []);
});

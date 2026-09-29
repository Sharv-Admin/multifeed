"use client";

import type { Team } from "@hexclave/next";
import { Email, UserAdd } from "@honeyicons/react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@multifeed/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@multifeed/ui/components/dialog";
import { Input } from "@multifeed/ui/components/input";
import { Label } from "@multifeed/ui/components/label";
import { Spinner } from "@multifeed/ui/components/spinner";
import { countUsedTeamSeats } from "@/lib/team-seats";

export function InviteModal({
  invitationsCount,
  membersCount,
  team,
  teamSeatLimit,
}: {
  invitationsCount: number;
  membersCount: number;
  team: Team;
  teamSeatLimit: number | undefined;
}) {
  "use no memo";

  const [email, setEmail] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const sendingRef = useRef(false);
  const usedSeats = countUsedTeamSeats(membersCount, invitationsCount);
  const isAtLimit = teamSeatLimit !== undefined && usedSeats >= teamSeatLimit;

  const reset = () => {
    setEmail("");
    setIsSending(false);
    setErrorMessage(null);
    sendingRef.current = false;
  };

  const handleOpenChange = (open: boolean) => {
    if (!open && sendingRef.current) return;
    setIsOpen(open);
    if (!open) reset();
  };

  const handleInvite = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sendingRef.current) return;
    sendingRef.current = true;
    setIsSending(true);
    setErrorMessage(null);

    void fetch("/api/team-members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim() }),
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as
          | { ok: true }
          | { error?: string };
        if (!response.ok || !("ok" in payload) || payload.ok !== true) {
          throw new Error(
            "error" in payload && payload.error
              ? payload.error
              : "Could not send team invitation",
          );
        }
        // The invitation is already sent; a refresh failure must not encourage
        // the user to send a duplicate invitation.
        await team.listInvitations().catch(() => {
          console.warn("Could not refresh the team invitation list");
        });
        setIsOpen(false);
        reset();
        toast.success("Invite sent.");
      })
      .catch((err) => {
        sendingRef.current = false;
        setIsSending(false);
        setErrorMessage(
          err instanceof Error ? err.message : "Could not send team invitation",
        );
      });
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button />}>
        <UserAdd size={16} />
        Invite member
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleInvite}>
          <DialogHeader>
            <DialogTitle>Invite teammate</DialogTitle>
            <DialogDescription className="sr-only">
              Email a team invitation.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="invite-email">Email address</Label>
              <Input
                id="invite-email"
                name="email"
                type="email"
                required
                autoComplete="email"
                autoFocus
                placeholder="teammate@company.com"
                value={email}
                disabled={isSending}
                aria-describedby={errorMessage ? "invite-error" : undefined}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setErrorMessage(null);
                }}
              />
              {isAtLimit && (
                <p className="text-sm text-muted-foreground">No seats left.</p>
              )}
              {errorMessage && (
                <p
                  id="invite-error"
                  role="alert"
                  className="text-sm text-destructive"
                >
                  {errorMessage}
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isSending}
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              disabled={!email.trim() || isSending || isAtLimit}
              type="submit"
            >
              {isSending ? <Spinner className="size-4" /> : <Email size={16} />}
              {isSending ? "Sending invite…" : "Send invite"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

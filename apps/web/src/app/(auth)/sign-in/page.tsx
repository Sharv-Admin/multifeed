"use client";

import { useHexclaveApp } from "@hexclave/next";
import { useEffect, useRef, useState } from "react";
import { Email, Google } from "@honeyicons/react";
import { toast } from "sonner";
import { Button } from "@multifeed/ui/components/button";
import { Input } from "@multifeed/ui/components/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@multifeed/ui/components/input-otp";
import { Spinner } from "@multifeed/ui/components/spinner";
import { Skeleton } from "@multifeed/ui/components/skeleton";

export default function SignInPage() {
  const app = useHexclaveApp();

  const [email, setEmail] = useState("");
  const [step, setStep] = useState<"email" | "otp">("email");
  const [nonce, setNonce] = useState("");
  const [otp, setOtp] = useState("");
  const [isEmailLoading, setIsEmailLoading] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const verificationPending = useRef(false);

  const handleSendMagicLink = async (
    source: "initial" | "resend" = "initial",
  ) => {
    if (source === "resend" && resendCooldown > 0) {
      return;
    }

    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      toast.error("Please enter your email address.");
      return;
    }

    setIsEmailLoading(true);

    try {
      const result = await app.sendMagicLinkEmail(normalizedEmail, {
        callbackUrl: `${window.location.origin}${app.urls.magicLinkCallback}`,
      });
      if (result.status === "error") {
        toast.error("Could not send verification code. Please try again.");
      } else {
        setEmail(normalizedEmail);
        setNonce(result.data.nonce);
        setOtp("");
        setStep("otp");
        setResendCooldown(20);
        toast.success("Verification code sent. Check your email.");
      }
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setIsEmailLoading(false);
    }
  };

  useEffect(() => {
    if (step !== "otp" || resendCooldown <= 0) return;

    const timer = window.setTimeout(() => {
      setResendCooldown((current) => Math.max(current - 1, 0));
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [step, resendCooldown]);

  useEffect(() => {
    if (otp.length !== 6 || verificationPending.current) return;
    verificationPending.current = true;
    let cancelled = false;

    const verify = async () => {
      setIsVerifying(true);
      try {
        const result = await app.signInWithMagicLink(otp + nonce);
        if (!cancelled && result.status === "error") {
          toast.error("Invalid code. Please try again.");
        }
      } catch {
        if (!cancelled) {
          toast.error("Something went wrong. Please try again.");
        }
      } finally {
        if (!cancelled) {
          setOtp("");
          setIsVerifying(false);
        }
        verificationPending.current = false;
      }
    };

    void verify();
    return () => {
      cancelled = true;
    };
  }, [app, nonce, otp]);

  const handleGoogleSignIn = async () => {
    setIsGoogleLoading(true);
    try {
      await app.signInWithOAuth("google", {
        returnTo: app.urls.afterSignIn,
      });
    } catch {
      toast.error("Could not continue with Google. Please try again.");
    } finally {
      setIsGoogleLoading(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6">
      <div className="text-center">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
          Welcome to MultiFeed
        </h1>
        <p className="mt-2 text-sm font-light text-muted-foreground">
          {step === "email"
            ? "Sign in to plan and schedule your posts"
            : `We sent a code to ${email}`}
        </p>
      </div>

      {step === "email" ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSendMagicLink("initial");
          }}
        >
          <div className="relative [&>input]:h-9 [&>input]:rounded-2xl [&>input]:pl-10">
            <Email
              size={20}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="[&>button]:rounded-2xl">
            <Button
              type="submit"
              disabled={isEmailLoading}
              size="lg"
              className="w-full"
            >
              {isEmailLoading ? <Spinner className="size-4" /> : null}
              Continue with Email
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col items-center gap-5 pt-1">
          <p className="text-center text-sm text-muted-foreground font-light">
            Enter the 6-character code from your email
          </p>
          <InputOTP
            maxLength={6}
            value={otp}
            onChange={(value) => setOtp(value.toUpperCase())}
            disabled={isVerifying}
            containerClassName="justify-center"
          >
            <InputOTPGroup>
              {[0, 1, 2, 3, 4, 5].map((index) => (
                <InputOTPSlot
                  key={index}
                  index={index}
                  className="ml-1.5 size-10 rounded-xl border border-solid border-zinc-300 bg-white text-lg font-semibold text-zinc-950 shadow-sm first:ml-0 data-[active=true]:border-primary data-[active=true]:ring-2 data-[active=true]:ring-primary/20"
                />
              ))}
            </InputOTPGroup>
          </InputOTP>
          {isVerifying ? (
            <Skeleton className="h-5 w-32" aria-label="Verifying..." />
          ) : null}
          <div className="flex flex-col items-center gap-2 text-sm">
            <p className="text-xs text-muted-foreground">
              {resendCooldown > 0
                ? `Resend available in ${resendCooldown}s`
                : "Didn't get the code?"}
            </p>
            <div className="flex items-center gap-4">
              <button
                type="button"
                disabled={isEmailLoading || resendCooldown > 0}
                onClick={() => void handleSendMagicLink("resend")}
                className="font-medium"
              >
                {isEmailLoading ? "Sending..." : "Resend code"}
              </button>
              <span className="text-muted-foreground">|</span>
              <button
                type="button"
                onClick={() => {
                  setStep("email");
                  setOtp("");
                  setNonce("");
                  setResendCooldown(0);
                }}
                className="font-medium"
              >
                Use a different email
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground font-medium">OR</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <div className="[&>button]:h-10 [&>button]:rounded-2xl">
        <Button
          variant="secondary"
          disabled={isGoogleLoading}
          size="lg"
          className="w-full"
          onClick={handleGoogleSignIn}
        >
          {isGoogleLoading ? (
            <Spinner className="size-4" />
          ) : (
            <Google size={18} />
          )}
          Continue with Google
        </Button>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        &copy; {new Date().getFullYear()} MultiFeed. All rights reserved.
      </p>
    </div>
  );
}

"use client";

import Link from "next/link";
import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const MEASUREMENT_ID = "G-C9B018YMX1";
const CONSENT_KEY = "multifeed-analytics-consent-v1";
const CONSENT_LIFETIME = 180 * 24 * 60 * 60 * 1000;
type Choice = "accepted" | "declined";
type AnalyticsWindow = Window & {
  dataLayer?: IArguments[];
  gtag?: (...args: unknown[]) => void;
  multifeedAnalyticsInitialized?: boolean;
};

function setAnalyticsDisabled(disabled: boolean) {
  (window as unknown as Record<string, unknown>)[
    `ga-disable-${MEASUREMENT_ID}`
  ] = disabled;
}

function clearAnalyticsCookies() {
  for (const cookie of document.cookie.split(";")) {
    const name = cookie.trim().split("=")[0];
    if (!name || !/^_ga(?:_|$)/.test(name)) continue;
    for (const domain of [
      "",
      "; domain=themultifeed.com",
      "; domain=.themultifeed.com",
    ]) {
      document.cookie = `${name}=; Max-Age=0; path=/${domain}; SameSite=Lax`;
    }
  }
}

export function AnalyticsConsent() {
  const pathname = usePathname();
  const [choice, setChoice] = useState<Choice | null>(null);
  const [ready, setReady] = useState(false);
  const [showPreferences, setShowPreferences] = useState(false);
  const lastPage = useRef<string | null>(null);
  const productionHost =
    typeof window !== "undefined" &&
    ["themultifeed.com", "www.themultifeed.com"].includes(
      window.location.hostname,
    );

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(CONSENT_KEY) || "null");
      if (
        stored &&
        ["accepted", "declined"].includes(stored.choice) &&
        typeof stored.at === "number" &&
        Date.now() - stored.at >= 0 &&
        Date.now() - stored.at < CONSENT_LIFETIME
      ) {
        setChoice(stored.choice);
      } else {
        clearAnalyticsCookies();
      }
    } catch {
      clearAnalyticsCookies();
    }
    setReady(true);
    return () => setAnalyticsDisabled(true);
  }, []);

  useEffect(() => {
    if (!ready || choice !== "accepted" || !productionHost) return;
    const analytics = window as AnalyticsWindow;
    setAnalyticsDisabled(false);
    if (!analytics.multifeedAnalyticsInitialized) {
      analytics.dataLayer = analytics.dataLayer || [];
      analytics.gtag = function () {
        analytics.dataLayer!.push(arguments);
      };
      analytics.gtag("consent", "default", {
        analytics_storage: "denied",
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
      });
      analytics.gtag("consent", "update", { analytics_storage: "granted" });
      analytics.gtag("js", new Date());
      analytics.gtag("config", MEASUREMENT_ID, {
        send_page_view: false,
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
        cookie_domain: "themultifeed.com",
        cookie_expires: CONSENT_LIFETIME / 1000,
      });
      analytics.multifeedAnalyticsInitialized = true;
    }
    // Never send query strings, fragments, auth routes, or dashboard content.
    const pageLocation = `https://themultifeed.com${pathname}`;
    analytics.gtag?.("set", {
      page_location: pageLocation,
      page_referrer: document.referrer
        ? (() => {
            try {
              return new URL(document.referrer).origin;
            } catch {
              return "";
            }
          })()
        : "",
    });
    if (lastPage.current !== pathname) {
      analytics.gtag?.("event", "page_view", {
        send_to: MEASUREMENT_ID,
        page_location: pageLocation,
        page_title: document.title,
      });
      lastPage.current = pathname;
    }
  }, [choice, pathname, productionHost, ready]);

  function saveChoice(nextChoice: Choice) {
    try {
      localStorage.setItem(
        CONSENT_KEY,
        JSON.stringify({ choice: nextChoice, at: Date.now() }),
      );
    } catch {
      // The choice still applies to this page when browser storage is blocked.
    }
    if (nextChoice === "declined") {
      setAnalyticsDisabled(true);
      clearAnalyticsCookies();
      lastPage.current = null;
      // Unload any previously accepted tag; no denied-consent pings are sent.
      if ((window as AnalyticsWindow).multifeedAnalyticsInitialized) {
        window.location.reload();
        return;
      }
    }
    setChoice(nextChoice);
    setShowPreferences(false);
  }

  return (
    <>
      {ready && choice === "accepted" && productionHost && (
        <Script
          id="multifeed-google-analytics"
          src={`https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`}
          strategy="afterInteractive"
        />
      )}
      <div className="bg-background py-4 text-center">
        <button
          type="button"
          className="rounded-sm text-sm text-muted-foreground underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          onClick={() => setShowPreferences(true)}
        >
          Cookie preferences
        </button>
      </div>
      {ready && (choice === null || showPreferences) && (
        <section
          aria-label="Cookie preferences"
          className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-xl rounded-2xl border bg-background p-5 text-foreground shadow-lg sm:p-6"
        >
          <h2 className="text-lg font-semibold">Your privacy matters</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Essential storage keeps MultiFeed working. With your permission, we
            also use Google Analytics to understand visits to our public
            website. We do not use it to track your dashboard or social posts.{" "}
            <Link
              href="/policies/privacy"
              className="underline underline-offset-4"
            >
              Privacy policy
            </Link>
            .
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <button
              type="button"
              className="rounded-lg border px-3 py-3 text-sm font-semibold hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              onClick={() => saveChoice("declined")}
            >
              Essential only
            </button>
            <button
              type="button"
              className="rounded-lg border px-3 py-3 text-sm font-semibold hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              onClick={() => saveChoice("accepted")}
            >
              Allow analytics
            </button>
          </div>
        </section>
      )}
    </>
  );
}

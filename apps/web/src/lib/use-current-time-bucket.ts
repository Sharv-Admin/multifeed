"use client";

import { useEffect, useState } from "react";
import { currentTimeBucket } from "@/lib/time-bucket";

export function useCurrentTimeBucket() {
  const [nowMs, setNowMs] = useState(currentTimeBucket);

  useEffect(() => {
    const refresh = () => setNowMs(currentTimeBucket());
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") refresh();
    };

    refresh();
    const intervalId = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return nowMs;
}

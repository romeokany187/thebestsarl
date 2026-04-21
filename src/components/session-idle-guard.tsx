"use client";

import { useEffect, useRef } from "react";
import { signOut } from "next-auth/react";
import { SESSION_INACTIVITY_TIMEOUT_MS } from "@/lib/session-security";

const LAST_ACTIVITY_STORAGE_KEY = "thebest:last-activity-at";

export function SessionIdleGuard() {
  const timerRef = useRef<number | null>(null);
  const isSigningOutRef = useRef(false);

  useEffect(() => {
    function readLastActivity() {
      const storedValue = window.localStorage.getItem(LAST_ACTIVITY_STORAGE_KEY);
      const parsed = storedValue ? Number.parseInt(storedValue, 10) : Number.NaN;
      return Number.isFinite(parsed) ? parsed : Date.now();
    }

    function clearExistingTimer() {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }

    async function expireSession() {
      if (isSigningOutRef.current) {
        return;
      }

      isSigningOutRef.current = true;
      clearExistingTimer();
      window.localStorage.removeItem(LAST_ACTIVITY_STORAGE_KEY);
      await signOut({ callbackUrl: "/auth/signin" });
    }

    function scheduleExpiry(fromTimestamp: number) {
      clearExistingTimer();
      const remainingMs = SESSION_INACTIVITY_TIMEOUT_MS - (Date.now() - fromTimestamp);

      if (remainingMs <= 0) {
        void expireSession();
        return;
      }

      timerRef.current = window.setTimeout(() => {
        void expireSession();
      }, remainingMs);
    }

    function registerActivity() {
      if (document.visibilityState === "hidden") {
        return;
      }

      const now = Date.now();
      window.localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(now));
      scheduleExpiry(now);
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        const lastActivityAt = readLastActivity();
        if (Date.now() - lastActivityAt >= SESSION_INACTIVITY_TIMEOUT_MS) {
          void expireSession();
          return;
        }
        scheduleExpiry(lastActivityAt);
      }
    }

    function handleStorage(event: StorageEvent) {
      if (event.key !== LAST_ACTIVITY_STORAGE_KEY) {
        return;
      }

      const lastActivityAt = event.newValue ? Number.parseInt(event.newValue, 10) : Number.NaN;
      if (Number.isFinite(lastActivityAt)) {
        scheduleExpiry(lastActivityAt);
        return;
      }

      void expireSession();
    }

    const initialActivityAt = readLastActivity();
    if (Date.now() - initialActivityAt >= SESSION_INACTIVITY_TIMEOUT_MS) {
      void expireSession();
      return;
    }

    scheduleExpiry(initialActivityAt);

    const activityEvents: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "mousemove", "scroll", "focus", "touchstart"];
    activityEvents.forEach((eventName) => {
      window.addEventListener(eventName, registerActivity, { passive: true });
    });
    window.addEventListener("storage", handleStorage);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearExistingTimer();
      activityEvents.forEach((eventName) => {
        window.removeEventListener(eventName, registerActivity);
      });
      window.removeEventListener("storage", handleStorage);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return null;
}
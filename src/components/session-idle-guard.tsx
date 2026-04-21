"use client";

import { useEffect, useRef } from "react";
import { signOut } from "next-auth/react";
import { SESSION_INACTIVITY_TIMEOUT_MS } from "@/lib/session-security";

const LAST_ACTIVITY_STORAGE_KEY = "thebest:last-activity-at";
const SESSION_IDLE_GUARD_SESSION_KEY = "thebest:session-idle-key";
const ACTIVITY_WRITE_THROTTLE_MS = 15 * 1000;

export function SessionIdleGuard({ sessionKey }: { sessionKey: string }) {
  const timerRef = useRef<number | null>(null);
  const isSigningOutRef = useRef(false);
  const lastActivityWriteRef = useRef(0);

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
      if (now - lastActivityWriteRef.current >= ACTIVITY_WRITE_THROTTLE_MS) {
        window.localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(now));
        lastActivityWriteRef.current = now;
      }
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
      if (event.key === SESSION_IDLE_GUARD_SESSION_KEY) {
        if (event.newValue && event.newValue !== sessionKey) {
          window.localStorage.setItem(SESSION_IDLE_GUARD_SESSION_KEY, sessionKey);
          const now = Date.now();
          window.localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(now));
          lastActivityWriteRef.current = now;
          scheduleExpiry(now);
        }
        return;
      }

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

    const storedSessionKey = window.localStorage.getItem(SESSION_IDLE_GUARD_SESSION_KEY);
    const initialActivityAt = storedSessionKey === sessionKey ? readLastActivity() : Date.now();

    if (storedSessionKey !== sessionKey) {
      window.localStorage.setItem(SESSION_IDLE_GUARD_SESSION_KEY, sessionKey);
      window.localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(initialActivityAt));
      lastActivityWriteRef.current = initialActivityAt;
    }

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
  }, [sessionKey]);

  return null;
}
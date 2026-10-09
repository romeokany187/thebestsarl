"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

const STORAGE_KEY = "thebest-theme";

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
}

function readStoredTheme(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "dark" || saved === "light") return saved;
  const preferredDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  return preferredDark ? "dark" : "light";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const stored = readStoredTheme();
    setTheme(stored);
    applyTheme(stored);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    applyTheme(theme);
  }, [theme, mounted]);

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
    localStorage.setItem(STORAGE_KEY, next);
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="rounded-full border border-black/15 bg-white px-3 py-1.5 text-xs font-semibold dark:border-white/20 dark:bg-zinc-900"
      aria-label="Basculer thème clair/sombre"
      title="Basculer thème clair/sombre"
    >
      <span suppressHydrationWarning>{!mounted ? "Thème" : theme === "dark" ? "Mode clair" : "Mode sombre"}</span>
    </button>
  );
}

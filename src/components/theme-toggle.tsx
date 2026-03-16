"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

const STORAGE_KEY = "thebest-theme";

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    const preferredDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const initial: Theme = saved === "dark" || saved === "light"
      ? (saved as Theme)
      : (preferredDark ? "dark" : "light");

    setTheme(initial);
    applyTheme(initial);
  }, []);

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
      {theme === "dark" ? "Mode clair" : "Mode sombre"}
    </button>
  );
}

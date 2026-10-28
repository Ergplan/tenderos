"use client";
import React from "react";
import { Moon, Sun } from "lucide-react";
import { setTheme, useTheme } from "./theme";

/** Day / night switch, remembered in this browser. */
export default function ThemeToggle({ className = "" }) {
  const mode = useTheme();
  const next = mode === "light" ? "dark" : "light";
  return (
    <button type="button" className={`theme-toggle ${className}`} onClick={() => setTheme(next)} data-testid="theme-toggle"
      aria-pressed={mode === "light"} title={next === "light" ? "Switch to day mode" : "Switch to night mode"}>
      {mode === "light" ? <Moon size={14} /> : <Sun size={14} />}
      <span>{mode === "light" ? "Night mode" : "Day mode"}</span>
    </button>
  );
}

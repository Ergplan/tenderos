// Day and night mode. The mode is <html data-theme="dark|light">, set before the first paint by
// the script in app/layout.js and kept in localStorage; styles.css holds the two token sets.
// Charts draw on a canvas, so their colours cannot follow CSS: chartColors() (themeColors.js)
// maps the night palette used across the chart options to its day equivalent.
import { useEffect, useState } from "react";
import { THEME_KEY } from "./themeScript.js";

export { chartColor, chartColors } from "./themeColors.js";
export { THEME_KEY };
export const THEMES = ["dark", "light"];
const EVENT = "tenderos-theme";

/** The mode on the page now ("dark" outside a browser). */
export function getTheme() {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

/** Switch the page to a mode and remember it in this browser. */
export function setTheme(mode) {
  const next = mode === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  document.documentElement.style.colorScheme = next;
  try { localStorage.setItem(THEME_KEY, next); } catch { /* private window: the mode lasts for the page */ }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
}

/** The current mode, re-rendering when it changes (in this tab or another). */
export function useTheme() {
  const [mode, setMode] = useState("dark");
  useEffect(() => {
    const sync = () => setMode(getTheme());
    sync();
    const onStorage = (e) => {
      if (e.key !== THEME_KEY || !e.newValue) return;
      document.documentElement.dataset.theme = e.newValue === "light" ? "light" : "dark";
      sync();
    };
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => { window.removeEventListener(EVENT, sync); window.removeEventListener("storage", onStorage); };
  }, []);
  return mode;
}

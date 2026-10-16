// Demo mode (DEMO_MODE=1): no login. Every visitor is signed in as one shared demo user who may
// open every tab; first-run setup, account changes and administration are switched off.
// APP_SWITCH_URL (optional) adds a link back to the page that chooses between apps.
export const DEMO_MODE = process.env.DEMO_MODE === "1";
export const DEMO_EMAIL = "demo@tenderos.local";
export const APP_SWITCH_URL = process.env.APP_SWITCH_URL || null;

import crypto from "node:crypto";
import { cookies } from "next/headers";
import { query } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { DEMO_EMAIL, DEMO_MODE } from "@/lib/demo";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/session";
import { logEvent, startSession } from "@/lib/activity";
import { ALL_TAB_IDS } from "@/lib/tabs";

// Demo mode only: sign the visitor in as the shared demo user (created on first use, with a
// random password nobody knows) and go on to `next`.
export async function GET(req) {
  if (!DEMO_MODE) return new Response("Not found", { status: 404 });
  await query(
    "INSERT INTO users (email, name, password_hash, role, tab_access) VALUES ($1, 'Demo', $2, 'user', $3) ON CONFLICT (email) DO NOTHING",
    [DEMO_EMAIL, await hashPassword(crypto.randomBytes(32).toString("base64")), JSON.stringify(ALL_TAB_IDS)],
  );
  const { rows } = await query("SELECT id, email, name, role, session_epoch FROM users WHERE email = $1", [DEMO_EMAIL]);
  const user = rows[0];
  const sid = await startSession(user, req);
  await logEvent({ user, sessionId: sid, kind: "login", detail: { demo: true }, req });
  (await cookies()).set(SESSION_COOKIE, await signSession(user, sid), sessionCookieOptions());
  const next = new URL(req.url).searchParams.get("next") || "/";
  const target = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return new Response(null, { status: 303, headers: { Location: target } });
}

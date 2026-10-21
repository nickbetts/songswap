import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

export const ADMIN_COOKIE = "ss_admin";

export function sessionSecret() {
  const s = process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD;
  if (s) return s;
  // A guessable fallback would let anyone forge admin/user sessions.
  if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET is not set on the server");
  return "dev-secret";
}

function sign(value: string) {
  return createHmac("sha256", sessionSecret()).update(value).digest("hex");
}

/** Rejects cross-site writes (CSRF): the request must come from our own origin. */
export function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  if (!origin) return true;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function safeEqual(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function checkAdminPassword(pw: string) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  return safeEqual(sign(pw), sign(expected));
}

export function makeAdminToken() {
  const exp = Date.now() + 1000 * 60 * 60 * 24 * 7;
  return `${exp}.${sign(`admin:${exp}`)}`;
}

function verifyAdminToken(token: string | undefined) {
  if (!token) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEqual(sig, sign(`admin:${exp}`));
}

export async function isAdmin() {
  const jar = await cookies();
  return verifyAdminToken(jar.get(ADMIN_COOKIE)?.value);
}

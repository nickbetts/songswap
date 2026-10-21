import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { currentHost } from "./users";

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

/** Host cookie, bound to the host account's id and password version: `id.ver.exp.sig`. */
export function makeAdminToken(host: { id: string; ver: number }) {
  const exp = Date.now() + 1000 * 60 * 60 * 12;
  const body = `${host.id}.${host.ver}.${exp}`;
  return `${body}.${sign(`admin:v2:${body}`)}`;
}

function parseAdminToken(token: string | undefined) {
  const parts = token?.split(".") ?? [];
  if (parts.length !== 4) return null;
  const [id, ver, exp, sig] = parts;
  if (!(Number(exp) > Date.now())) return null;
  if (!safeEqual(sig, sign(`admin:v2:${id}.${ver}.${exp}`))) return null;
  return { id, ver: Number(ver) };
}

/** Host access needs a valid host cookie AND a live login session as the host account. */
export async function isAdmin() {
  const jar = await cookies();
  const t = parseAdminToken(jar.get(ADMIN_COOKIE)?.value);
  if (!t) return false;
  const host = await currentHost();
  return !!host && host.id === t.id && host.ver === t.ver;
}

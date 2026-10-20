import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

export const ADMIN_COOKIE = "ss_admin";

function secret() {
  return process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || "dev-secret";
}

function sign(value: string) {
  return createHmac("sha256", secret()).update(value).digest("hex");
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

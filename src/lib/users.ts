import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { cookies } from "next/headers";
import { getKV, withLock } from "./store";
import { isAdmin, sessionSecret } from "./auth";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

const USERS_KEY = "ss:users";
const SEEDED_KEY = "ss:users:seeded";
export const USER_COOKIE = "ss_user";
export const LEGACY_PASSWORD = "i3media";
const SESSION_MS = 1000 * 60 * 60 * 24 * 30;
const MAX_FAILS = 8;
const LOCK_MS = 15 * 60_000;

/** The host's identity when signed in on /admin without a personal account session. */
export const HOST_PERSON = { id: "host-nick-0001", name: "Nick" };

interface UserRec {
  id: string;
  name: string;
  hash: string;
  salt: string;
  mustChange: boolean;
  /** Bumped on password change so older sessions stop working. */
  ver: number;
  createdAt: number;
}

type Users = Record<string, UserRec>;

export interface SessionUser {
  id: string;
  name: string;
  mustChange: boolean;
}

export class AuthError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const nameKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

async function hashPassword(pw: string, salt = randomBytes(16)) {
  const hash = await scrypt(pw.normalize("NFKC"), salt, 64);
  return { hash: hash.toString("hex"), salt: salt.toString("hex") };
}

async function verifyPassword(pw: string, rec: UserRec) {
  const { hash } = await hashPassword(pw, Buffer.from(rec.salt, "hex"));
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(rec.hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

async function loadUsers(): Promise<Users> {
  return (await getKV().get<Users>(USERS_KEY)) ?? {};
}

/**
 * One-off migration: everyone who has already requested a song gets an account under that name
 * (keeping their existing id so history/leaderboard stay attached) with the shared legacy password.
 */
async function ensureSeeded() {
  if (await getKV().get(SEEDED_KEY)) return;
  await withLock("users", async () => {
    if (await getKV().get(SEEDED_KEY)) return;
    type Person = { id: string; name: string };
    type E = { addedBy?: Person };
    const state = await getKV().get<{ queue?: E[]; nowPlaying?: E | null; history?: E[] }>("ss:state");
    const entries = [...(state?.queue ?? []), ...(state?.nowPlaying ? [state.nowPlaying] : []), ...(state?.history ?? [])];

    // Per name, pick the id used most often.
    const counts = new Map<string, Map<string, { name: string; n: number }>>();
    for (const e of entries) {
      const p = e.addedBy;
      if (!p?.id || !p.name?.trim()) continue;
      const k = nameKey(p.name);
      const byId = counts.get(k) ?? new Map();
      const c = byId.get(p.id) ?? { name: p.name.trim(), n: 0 };
      c.n++;
      byId.set(p.id, c);
      counts.set(k, byId);
    }

    const users = await loadUsers();
    const takenIds = new Set(Object.values(users).map((u) => u.id));
    for (const [k, byId] of counts) {
      if (users[k]) continue;
      const [id, best] = [...byId.entries()].sort((a, b) => b[1].n - a[1].n)[0];
      if (takenIds.has(id)) continue;
      users[k] = {
        id,
        name: best.name,
        ...(await hashPassword(LEGACY_PASSWORD)),
        mustChange: true,
        ver: 1,
        createdAt: Date.now(),
      };
      takenIds.add(id);
    }
    await getKV().set(USERS_KEY, users);
    await getKV().set(SEEDED_KEY, Date.now());
  });
}

/* ───────────── Sessions ───────────── */

function sign(v: string) {
  return createHmac("sha256", sessionSecret()).update(v).digest("hex");
}

function makeToken(u: UserRec) {
  const exp = Date.now() + SESSION_MS;
  const body = `${u.id}.${u.ver}.${exp}`;
  return `${body}.${sign(`user:${body}`)}`;
}

function parseToken(token: string | undefined) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [id, ver, exp, sig] = parts;
  if (Number(exp) < Date.now()) return null;
  const expected = Buffer.from(sign(`user:${id}.${ver}.${exp}`));
  const got = Buffer.from(sig);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  return { id, ver: Number(ver) };
}

export const sessionCookie = (u: UserRec) =>
  ({
    name: USER_COOKIE,
    value: makeToken(u),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MS / 1000,
    path: "/",
  }) as const;

export async function currentUser(): Promise<SessionUser | null> {
  const t = parseToken((await cookies()).get(USER_COOKIE)?.value);
  if (!t) return null;
  const u = Object.values(await loadUsers()).find((x) => x.id === t.id);
  if (!u || u.ver !== t.ver) return null;
  return { id: u.id, name: u.name, mustChange: u.mustChange };
}

/** The person performing a player action: a logged-in user, or the host on /admin. */
export async function requireActor(): Promise<{ id: string; name: string }> {
  const u = await currentUser();
  if (u) {
    if (u.mustChange) throw new AuthError(403, "Please change your password first");
    return { id: u.id, name: u.name };
  }
  if (await isAdmin()) return HOST_PERSON;
  throw new AuthError(401, "Please log in");
}

/* ───────────── Account actions ───────────── */

function validName(raw: unknown) {
  const name = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (!/^[\p{L}\p{N}][\p{L}\p{N} _.'-]{1,23}$/u.test(name)) {
    throw new AuthError(400, "Username must be 2–24 letters, numbers, spaces or _ . ' -");
  }
  return name;
}

function validPassword(raw: unknown) {
  if (typeof raw !== "string" || raw.length < 6 || raw.length > 200) {
    throw new AuthError(400, "Password must be at least 6 characters");
  }
  return raw;
}

async function checkRateLimit(key: string) {
  const r = await getKV().get<{ n: number; until: number }>(`ss:rl:${key}`);
  if (r && r.n >= MAX_FAILS && r.until > Date.now()) {
    throw new AuthError(429, "Too many attempts. Try again in a few minutes");
  }
}

async function recordFail(key: string) {
  const k = `ss:rl:${key}`;
  const r = await getKV().get<{ n: number; until: number }>(k);
  const fresh = !r || r.until < Date.now();
  await getKV().set(k, { n: fresh ? 1 : r.n + 1, until: Date.now() + LOCK_MS });
  await new Promise((res) => setTimeout(res, 500));
}

export async function register(rawName: unknown, rawPw: unknown) {
  await ensureSeeded();
  const name = validName(rawName);
  const pw = validPassword(rawPw);
  if (pw === LEGACY_PASSWORD) throw new AuthError(400, "Pick a different password");
  const { hash, salt } = await hashPassword(pw);
  return withLock("users", async () => {
    const users = await loadUsers();
    const k = nameKey(name);
    if (users[k]?.mustChange) {
      throw new AuthError(409, `“${users[k].name}” already has an account. Log in with the temporary password ${LEGACY_PASSWORD}`);
    }
    if (users[k]) throw new AuthError(409, "That username is taken. Log in instead?");
    const rec: UserRec = {
      id: randomBytes(12).toString("hex"),
      name,
      hash,
      salt,
      mustChange: false,
      ver: 1,
      createdAt: Date.now(),
    };
    users[k] = rec;
    await getKV().set(USERS_KEY, users);
    return rec;
  });
}

export async function login(rawName: unknown, rawPw: unknown) {
  await ensureSeeded();
  const k = typeof rawName === "string" ? nameKey(rawName).slice(0, 64) : "";
  const pw = typeof rawPw === "string" ? rawPw.slice(0, 200) : "";
  if (!k || !pw) throw new AuthError(400, "Enter your username and password");
  await checkRateLimit(`login:${k}`);
  const u = (await loadUsers())[k];
  if (!u || !(await verifyPassword(pw, u))) {
    await recordFail(`login:${k}`);
    if (u?.mustChange) throw new AuthError(401, `Wrong password. Your temporary password is ${LEGACY_PASSWORD}`);
    throw new AuthError(401, "Wrong username or password");
  }
  await getKV().del(`ss:rl:login:${k}`);
  return u;
}

export async function changePassword(current: unknown, next: unknown) {
  const me = await currentUser();
  if (!me) throw new AuthError(401, "Please log in");
  const pw = validPassword(next);
  if (pw === LEGACY_PASSWORD) throw new AuthError(400, "Pick a different password");
  const k = nameKey(me.name);
  await checkRateLimit(`pw:${k}`);
  return withLock("users", async () => {
    const users = await loadUsers();
    const u = users[k];
    if (!u || u.id !== me.id) throw new AuthError(401, "Please log in");
    if (typeof current !== "string" || !(await verifyPassword(current, u))) {
      await recordFail(`pw:${k}`);
      throw new AuthError(401, "Current password is wrong");
    }
    Object.assign(u, await hashPassword(pw), { mustChange: false, ver: u.ver + 1 });
    await getKV().set(USERS_KEY, users);
    return u;
  });
}

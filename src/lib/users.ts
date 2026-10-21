import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { cookies } from "next/headers";
import { getKV, withLock } from "./store";
import { checkAdminPassword, sessionSecret } from "./auth";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

const USERS_KEY = "ss:users";
const SEEDED_KEY = "ss:users:seeded";
export const USER_COOKIE = "ss_user";
export const LEGACY_PASSWORD = "i3media";
const SESSION_MS = 1000 * 60 * 60 * 24 * 30;
const MAX_FAILS = 8;
const LOCK_MS = 15 * 60_000;

/** Only this account may use the host controls (together with ADMIN_PASSWORD). */
export const HOST_USERNAME = process.env.HOST_USERNAME || "Nick";

interface UserRec {
  id: string;
  name: string;
  hash: string;
  salt: string;
  mustChange: boolean;
  /** Bumped on password change so older sessions stop working. */
  ver: number;
  createdAt: number;
  /** New sign-ups need the host's approval before they can queue, rate or vote. Missing = approved. */
  approved?: boolean;
}

type Users = Record<string, UserRec>;

export interface SessionUser {
  id: string;
  name: string;
  mustChange: boolean;
  pending: boolean;
}

export class AuthError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const nameKey = (name: string) => name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

/** Collapses look-alike spellings ("N1ck", "Ni ck", "nick.") so nobody can pose as someone else. */
function skeleton(name: string) {
  return nameKey(name)
    .replace(/[\s_.'-]/g, "")
    .replace(/rn/g, "m")
    .replace(/vv/g, "w")
    .replace(/[0]/g, "o")
    .replace(/[1il|]/g, "l")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5/g, "s")
    .replace(/7/g, "t")
    .replace(/8/g, "b");
}

const isHostKey = (k: string) => k === nameKey(HOST_USERNAME);

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
  return { id: u.id, name: u.name, mustChange: u.mustChange, pending: u.approved === false };
}

/**
 * The current session if it belongs to the host account (and the host has set their own
 * password). Includes `ver` so host cookies die when the host changes password.
 */
export async function currentHost(): Promise<{ id: string; ver: number } | null> {
  const t = parseToken((await cookies()).get(USER_COOKIE)?.value);
  if (!t) return null;
  const u = (await loadUsers())[nameKey(HOST_USERNAME)];
  if (!u || u.id !== t.id || u.ver !== t.ver || u.mustChange) return null;
  return { id: u.id, ver: u.ver };
}

/** The logged-in person performing a player action. */
export async function requireActor(): Promise<{ id: string; name: string }> {
  const u = await currentUser();
  if (!u) throw new AuthError(401, "Please log in");
  if (u.mustChange) throw new AuthError(403, "Please change your password first");
  if (u.pending) throw new AuthError(403, "Waiting for the host to approve your account");
  return { id: u.id, name: u.name };
}

/* ───────────── Account actions ───────────── */

function validName(raw: unknown) {
  const name = typeof raw === "string" ? raw.normalize("NFKC").trim().replace(/\s+/g, " ") : "";
  if (!/^[A-Za-z0-9][A-Za-z0-9 _.'-]{1,23}$/.test(name)) {
    throw new AuthError(400, "Username must be 2–24 English letters, numbers, spaces or _ . ' -");
  }
  return name;
}

function validPassword(raw: unknown) {
  if (typeof raw !== "string" || raw.length < 6 || raw.length > 200) {
    throw new AuthError(400, "Password must be at least 6 characters");
  }
  return raw;
}

/**
 * Counts an attempt atomically *before* checking the password, so parallel requests can't
 * slip past the limit. Throws once `max` attempts have been made inside the window.
 */
export async function limitAttempts(key: string, max = MAX_FAILS, windowMs = LOCK_MS) {
  const n = await getKV().incr(`ss:rl2:${key}`, windowMs);
  if (n > max) throw new AuthError(429, "Too many attempts. Try again in a few minutes");
}

export const clearAttempts = (key: string) => getKV().del(`ss:rl2:${key}`);

const failDelay = () => new Promise((res) => setTimeout(res, 500));

export async function register(rawName: unknown, rawPw: unknown, ip: string, adminPassword?: unknown) {
  await ensureSeeded();
  const name = validName(rawName);
  const pw = validPassword(rawPw);
  await limitAttempts(`reg:${ip}`, 30, 60 * 60_000);
  // The host name can only be claimed with the admin password (e.g. on a fresh install).
  if (isHostKey(nameKey(name)) && !(typeof adminPassword === "string" && checkAdminPassword(adminPassword))) {
    throw new AuthError(409, "That username is reserved");
  }
  if (pw === LEGACY_PASSWORD) throw new AuthError(400, "Pick a different password");
  const { hash, salt } = await hashPassword(pw);
  return withLock("users", async () => {
    const users = await loadUsers();
    const k = nameKey(name);
    if (users[k]?.mustChange) {
      throw new AuthError(409, `“${users[k].name}” already has an account. Log in with the temporary password ${LEGACY_PASSWORD}`);
    }
    if (users[k]) throw new AuthError(409, "That username is taken. Log in instead?");
    const sk = skeleton(name);
    const lookalike =
      Object.values(users).some((u) => skeleton(u.name) === sk) || (!isHostKey(k) && sk === skeleton(HOST_USERNAME));
    if (lookalike) throw new AuthError(409, "That username is too similar to someone else's. Pick another");
    const rec: UserRec = {
      id: randomBytes(12).toString("hex"),
      name,
      hash,
      salt,
      mustChange: false,
      ver: 1,
      createdAt: Date.now(),
      approved: isHostKey(k),
    };
    users[k] = rec;
    await getKV().set(USERS_KEY, users);
    return rec;
  });
}

export async function login(rawName: unknown, rawPw: unknown, ip: string) {
  await ensureSeeded();
  const k = typeof rawName === "string" ? nameKey(rawName).slice(0, 64) : "";
  const pw = typeof rawPw === "string" ? rawPw.slice(0, 200) : "";
  if (!k || !pw) throw new AuthError(400, "Enter your username and password");
  await limitAttempts(`ip:${ip}`, 100);
  await limitAttempts(`login:${k}`);
  const u = (await loadUsers())[k];
  if (!u || !(await verifyPassword(pw, u))) {
    await failDelay();
    if (u?.mustChange) throw new AuthError(401, `Wrong password. Your temporary password is ${LEGACY_PASSWORD}`);
    throw new AuthError(401, "Wrong username or password");
  }
  await clearAttempts(`login:${k}`);
  return u;
}

export async function changePassword(current: unknown, next: unknown) {
  const me = await currentUser();
  if (!me) throw new AuthError(401, "Please log in");
  const pw = validPassword(next);
  if (pw === LEGACY_PASSWORD) throw new AuthError(400, "Pick a different password");
  const k = nameKey(me.name);
  await limitAttempts(`pw:${k}`);
  return withLock("users", async () => {
    const users = await loadUsers();
    const u = users[k];
    if (!u || u.id !== me.id) throw new AuthError(401, "Please log in");
    if (typeof current !== "string" || !(await verifyPassword(current, u))) {
      await failDelay();
      throw new AuthError(401, "Current password is wrong");
    }
    Object.assign(u, await hashPassword(pw), { mustChange: false, ver: u.ver + 1 });
    await getKV().set(USERS_KEY, users);
    await clearAttempts(`pw:${k}`);
    return u;
  });
}

/* ───────────── Host: account management ───────────── */

export async function listUsers() {
  await ensureSeeded();
  const host = nameKey(HOST_USERNAME);
  return Object.entries(await loadUsers())
    .map(([k, u]) => ({
      id: u.id,
      name: u.name,
      createdAt: u.createdAt,
      pending: u.approved === false,
      tempPassword: u.mustChange,
      host: k === host,
    }))
    .sort((a, b) => Number(b.pending) - Number(a.pending) || b.createdAt - a.createdAt);
}

async function updateUser(id: unknown, fn: (users: Users, k: string) => void) {
  if (typeof id !== "string" || !id) throw new AuthError(400, "Invalid user");
  await withLock("users", async () => {
    const users = await loadUsers();
    const k = Object.keys(users).find((x) => users[x].id === id);
    if (!k) throw new AuthError(404, "No such user");
    if (isHostKey(k)) throw new AuthError(403, "You can't change the host account here");
    fn(users, k);
    await getKV().set(USERS_KEY, users);
  });
}

export const setApproved = (id: unknown, approved: boolean) =>
  updateUser(id, (users, k) => {
    users[k].approved = approved;
  });

/** Deletes the account and signs it out everywhere (its played songs and scores stay in history). */
export const deleteUser = (id: unknown) =>
  updateUser(id, (users, k) => {
    delete users[k];
  });

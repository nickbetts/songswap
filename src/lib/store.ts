import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

export interface KV {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  /** Set only if absent, with a TTL in ms. Returns true if the key was set. */
  setNX(key: string, value: string, ttlMs: number): Promise<boolean>;
}

class MemoryKV implements KV {
  private data = new Map<string, { v: unknown; exp?: number }>();

  private live(key: string) {
    const e = this.data.get(key);
    if (!e) return undefined;
    if (e.exp && e.exp < Date.now()) {
      this.data.delete(key);
      return undefined;
    }
    return e;
  }

  async get<T>(key: string) {
    const e = this.live(key);
    return e ? (structuredClone(e.v) as T) : null;
  }
  async set(key: string, value: unknown) {
    this.data.set(key, { v: structuredClone(value) });
  }
  async del(key: string) {
    this.data.delete(key);
  }
  async setNX(key: string, value: string, ttlMs: number) {
    if (this.live(key)) return false;
    this.data.set(key, { v: value, exp: Date.now() + ttlMs });
    return true;
  }
}

class NeonKV implements KV {
  private sql: NeonQueryFunction<false, false>;
  private ready: Promise<unknown> | null = null;

  constructor(url: string) {
    this.sql = neon(url);
  }

  private init() {
    this.ready ??= this.sql`CREATE TABLE IF NOT EXISTS kv (
      key text PRIMARY KEY,
      value jsonb NOT NULL,
      expires_at timestamptz
    )`.catch((e) => {
      this.ready = null;
      throw e;
    });
    return this.ready;
  }

  async get<T>(key: string) {
    await this.init();
    const rows = await this.sql`SELECT value FROM kv WHERE key = ${key} AND (expires_at IS NULL OR expires_at > now())`;
    return rows.length ? (rows[0].value as T) : null;
  }
  async set(key: string, value: unknown) {
    await this.init();
    await this.sql`INSERT INTO kv (key, value, expires_at) VALUES (${key}, ${JSON.stringify(value)}::jsonb, NULL)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, expires_at = NULL`;
  }
  async del(key: string) {
    await this.init();
    await this.sql`DELETE FROM kv WHERE key = ${key}`;
  }
  async setNX(key: string, value: string, ttlMs: number) {
    await this.init();
    const rows = await this.sql`INSERT INTO kv (key, value, expires_at)
      VALUES (${key}, ${JSON.stringify(value)}::jsonb, now() + (${ttlMs} * interval '1 millisecond'))
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at
        WHERE kv.expires_at IS NOT NULL AND kv.expires_at <= now()
      RETURNING key`;
    return rows.length > 0;
  }
}

const g = globalThis as unknown as { __songswapKV?: KV };

export function getKV(): KV {
  if (g.__songswapKV) return g.__songswapKV;
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (url) {
    g.__songswapKV = new NeonKV(url);
  } else {
    if (process.env.VERCEL) {
      console.warn("No database configured on Vercel (set DATABASE_URL); state will not persist across invocations.");
    }
    g.__songswapKV = new MemoryKV();
  }
  return g.__songswapKV;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Short-lived mutex around read-modify-write sections. */
export async function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const kv = getKV();
  const key = `ss:lock:${name}`;
  const token = Math.random().toString(36).slice(2);
  const deadline = Date.now() + 5000;
  while (!(await kv.setNX(key, token, 4000))) {
    if (Date.now() > deadline) throw new Error("Busy, try again");
    await sleep(60 + Math.random() * 60);
  }
  try {
    return await fn();
  } finally {
    await kv.del(key);
  }
}

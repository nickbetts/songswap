import { Redis } from "@upstash/redis";

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

class UpstashKV implements KV {
  constructor(private redis: Redis) {}

  async get<T>(key: string) {
    return (await this.redis.get<T>(key)) ?? null;
  }
  async set(key: string, value: unknown) {
    await this.redis.set(key, value);
  }
  async del(key: string) {
    await this.redis.del(key);
  }
  async setNX(key: string, value: string, ttlMs: number) {
    const res = await this.redis.set(key, value, { nx: true, px: ttlMs });
    return res === "OK";
  }
}

const g = globalThis as unknown as { __songswapKV?: KV };

export function getKV(): KV {
  if (g.__songswapKV) return g.__songswapKV;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && token) {
    g.__songswapKV = new UpstashKV(new Redis({ url, token }));
  } else {
    if (process.env.VERCEL) {
      console.warn("No Redis configured on Vercel; state will not persist across invocations.");
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

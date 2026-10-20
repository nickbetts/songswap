import { getKV, withLock } from "./store";

const KEY = "ss:spotify";
export const SCOPES = [
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
].join(" ");

export interface SpotifyAuth {
  refreshToken: string;
  accessToken: string;
  expiresAt: number;
  displayName?: string;
}

export interface Track {
  id: string;
  uri: string;
  name: string;
  artists: string;
  album: string;
  image: string | null;
  durationMs: number;
  explicit: boolean;
}

export interface Playback {
  isPlaying: boolean;
  progressMs: number;
  trackId: string | null;
  durationMs: number;
}

export class SpotifyError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function basicAuth() {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) throw new SpotifyError(500, "Spotify client credentials are not configured");
  return "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");
}

export async function exchangeCode(code: string, redirectUri: string) {
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { Authorization: basicAuth(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
  });
  if (!res.ok) throw new SpotifyError(res.status, `Token exchange failed: ${await res.text()}`);
  return (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
}

export async function getAuth(): Promise<SpotifyAuth | null> {
  return getKV().get<SpotifyAuth>(KEY);
}

export async function saveAuth(auth: SpotifyAuth) {
  await getKV().set(KEY, auth);
}

export async function clearAuth() {
  await getKV().del(KEY);
}

async function refreshIfNeeded(): Promise<string> {
  const auth = await getAuth();
  if (!auth) throw new SpotifyError(503, "Spotify is not connected yet");
  if (auth.expiresAt - 30_000 > Date.now()) return auth.accessToken;

  return withLock("token", async () => {
    const fresh = await getAuth();
    if (!fresh) throw new SpotifyError(503, "Spotify is not connected yet");
    if (fresh.expiresAt - 30_000 > Date.now()) return fresh.accessToken;
    const res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { Authorization: basicAuth(), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: fresh.refreshToken }),
    });
    if (!res.ok) throw new SpotifyError(res.status, `Token refresh failed: ${await res.text()}`);
    const j = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
    await saveAuth({
      ...fresh,
      accessToken: j.access_token,
      refreshToken: j.refresh_token ?? fresh.refreshToken,
      expiresAt: Date.now() + j.expires_in * 1000,
    });
    return j.access_token;
  });
}

async function api(path: string, init: RequestInit & { json?: unknown } = {}) {
  const token = await refreshIfNeeded();
  const { json, ...rest } = init;
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    ...rest,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: json !== undefined ? JSON.stringify(json) : undefined,
    cache: "no-store",
  });
  if (res.status === 204 || res.status === 202) return null;
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = await res.json();
      msg = j?.error?.message || msg;
    } catch {}
    throw new SpotifyError(res.status, msg);
  }
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    // Some player commands answer 200 with a non-JSON body.
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapTrack(t: any): Track {
  return {
    id: t.id,
    uri: t.uri,
    name: t.name,
    artists: (t.artists ?? []).map((a: { name: string }) => a.name).join(", "),
    album: t.album?.name ?? "",
    image: t.album?.images?.[1]?.url ?? t.album?.images?.[0]?.url ?? null,
    durationMs: t.duration_ms,
    explicit: !!t.explicit,
  };
}

export async function me(token?: string) {
  const res = await fetch("https://api.spotify.com/v1/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new SpotifyError(res.status, "Could not read Spotify profile");
  return (await res.json()) as { display_name?: string; id: string; product?: string };
}

export async function searchTracks(q: string): Promise<Track[]> {
  const j = await api(`/search?${new URLSearchParams({ q, type: "track", limit: "10" })}`);
  return (j?.tracks?.items ?? []).filter(Boolean).map(mapTrack);
}

export async function getTrack(id: string): Promise<Track> {
  return mapTrack(await api(`/tracks/${encodeURIComponent(id)}`));
}

export async function getPlayback(): Promise<Playback | null> {
  const j = await api("/me/player?additional_types=track");
  if (!j || !j.item) return null;
  return {
    isPlaying: !!j.is_playing,
    progressMs: j.progress_ms ?? 0,
    trackId: j.item.id ?? null,
    durationMs: j.item.duration_ms ?? 0,
  };
}

/** Picks a usable device when Spotify reports no active one (e.g. the desktop app is open but idle). */
async function pickDeviceId(): Promise<string | null> {
  const j = await api("/me/player/devices");
  const devices = ((j?.devices ?? []) as { id: string | null; is_active: boolean; is_restricted: boolean; type: string }[])
    .filter((d) => d.id && !d.is_restricted);
  const d = devices.find((x) => x.is_active) ?? devices.find((x) => x.type === "Computer") ?? devices[0];
  return d?.id ?? null;
}

/** Runs a player command; on "no active device" retries targeting an available device, which also wakes it up. */
async function player(path: string, init: RequestInit & { json?: unknown }) {
  try {
    return await api(path, init);
  } catch (e) {
    if (!(e instanceof SpotifyError) || e.status !== 404) throw e;
    const id = await pickDeviceId();
    if (!id) throw e;
    const sep = path.includes("?") ? "&" : "?";
    return api(`${path}${sep}device_id=${encodeURIComponent(id)}`, init);
  }
}

export const addToSpotifyQueue = (uri: string) =>
  player(`/me/player/queue?${new URLSearchParams({ uri })}`, { method: "POST" });

export const playUris = (uris: string[]) => player("/me/player/play", { method: "PUT", json: { uris } });

export const pause = () => player("/me/player/pause", { method: "PUT" });
export const resume = () => player("/me/player/play", { method: "PUT" });
export const skipNext = () => player("/me/player/next", { method: "POST" });

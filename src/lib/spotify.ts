import { getKV, withLock } from "./store";

const KEY = "ss:spotify";
const DEVICE_KEY = "ss:device";
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
  albumUri?: string;
  image: string | null;
  durationMs: number;
  explicit: boolean;
}

export interface Playback {
  isPlaying: boolean;
  progressMs: number;
  trackId: string | null;
  durationMs: number;
  deviceId?: string | null;
  deviceName?: string | null;
}

export interface Device {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  volumePercent: number | null;
  supportsVolume: boolean;
}


export class SpotifyError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Raised when the host's chosen playback device can't be reached. */
export class DeviceUnavailableError extends SpotifyError {}

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
    albumUri: t.album?.uri,
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
    deviceId: j.device?.id ?? null,
    deviceName: j.device?.name ?? null,
  };
}

export async function listDevices(): Promise<Device[]> {
  const j = await api("/me/player/devices");
  return ((j?.devices ?? []) as {
    id: string | null; name: string; type: string; is_active: boolean; is_restricted: boolean;
    volume_percent: number | null; supports_volume?: boolean;
  }[])
    .filter((d) => d.id && !d.is_restricted)
    .map((d) => ({
      id: d.id!, name: d.name, type: d.type, isActive: d.is_active,
      volumePercent: d.volume_percent ?? null, supportsVolume: d.supports_volume !== false,
    }));
}

/** Volume must target the saved device, never a different device Spotify happens to make active. */
export async function setDeviceVolume(deviceId: string, percent: number) {
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
    throw new SpotifyError(400, "Volume must be an integer from 0 to 100");
  }
  await api(withDevice(`/me/player/volume?volume_percent=${percent}`, deviceId), { method: "PUT" });
}

/** The device the host picked to play through (null = let Spotify decide). */
export async function getChosenDevice() {
  return getKV().get<{ id: string; name: string }>(DEVICE_KEY);
}

/** Saves the host's device choice and moves playback onto it. */
export async function chooseDevice(id: string | null) {
  if (!id) {
    await getKV().del(DEVICE_KEY);
    return;
  }
  const d = (await listDevices()).find((x) => x.id === id);
  if (!d) throw new SpotifyError(404, "That device isn't available any more. Refresh the list");
  await getKV().set(DEVICE_KEY, { id: d.id, name: d.name });
  if (!d.isActive) {
    const pb = await getPlayback().catch(() => null);
    await api("/me/player", { method: "PUT", json: { device_ids: [d.id], play: !!pb?.isPlaying } });
  }
}

/** Picks a usable device when Spotify reports no active one (e.g. the desktop app is open but idle). */
async function pickDeviceId(): Promise<string | null> {
  const j = await api("/me/player/devices");
  const devices = ((j?.devices ?? []) as { id: string | null; is_active: boolean; is_restricted: boolean; type: string }[])
    .filter((d) => d.id && !d.is_restricted);
  const d = devices.find((x) => x.is_active) ?? devices.find((x) => x.type === "Computer") ?? devices[0];
  return d?.id ?? null;
}

const withDevice = (path: string, id: string) => `${path}${path.includes("?") ? "&" : "?"}device_id=${encodeURIComponent(id)}`;

/**
 * Runs a player command. If the host chose a device, always target it (this also wakes it up and
 * moves playback there). Otherwise use Spotify's active device, falling back to any available one.
 */
async function player(path: string, init: RequestInit & { json?: unknown }) {
  const chosen = await getChosenDevice();
  if (chosen) {
    try {
      return await api(withDevice(path, chosen.id), init);
    } catch (e) {
      if (e instanceof SpotifyError && e.status === 404) {
        throw new DeviceUnavailableError(
          404,
          `Can't reach “${chosen.name}”. Make sure Spotify is open on it, or pick another device on the host page.`,
        );
      }
      throw e;
    }
  }
  try {
    return await api(path, init);
  } catch (e) {
    if (!(e instanceof SpotifyError) || e.status !== 404) throw e;
    const id = await pickDeviceId();
    if (!id) throw e;
    return api(withDevice(path, id), init);
  }
}

export const addToSpotifyQueue = (uri: string) =>
  player(`/me/player/queue?${new URLSearchParams({ uri })}`, { method: "POST" });

/**
 * Starts a track. The desktop app sometimes accepts a bare `uris` play (204) but never loads
 * anything, leaving the player greyed out, so start it inside its album context instead.
 * Falls back to `uris` if the context play is rejected (e.g. unusual tracks).
 */
export async function playTrack(track: Pick<Track, "id" | "uri" | "albumUri">) {
  let albumUri = track.albumUri;
  if (!albumUri) {
    try {
      albumUri = (await api(`/tracks/${encodeURIComponent(track.id)}`))?.album?.uri;
    } catch {}
  }
  if (albumUri) {
    try {
      return await player("/me/player/play", { method: "PUT", json: { context_uri: albumUri, offset: { uri: track.uri } } });
    } catch (e) {
      if (!(e instanceof SpotifyError) || e instanceof DeviceUnavailableError || e.status === 401 || e.status === 403 && /premium/i.test(e.message)) throw e;
    }
  }
  return player("/me/player/play", { method: "PUT", json: { uris: [track.uri] } });
}

export const pause = () => player("/me/player/pause", { method: "PUT" });
export const resume = () => player("/me/player/play", { method: "PUT" });
export const skipNext = () => player("/me/player/next", { method: "POST" });

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface TrackInfo {
  id: string;
  uri: string;
  name: string;
  artists: string;
  album: string;
  image: string | null;
  durationMs: number;
  explicit: boolean;
}

export interface PublicEntry {
  id: string;
  track: TrackInfo;
  addedBy: { id: string; name: string };
  average: number | null;
  ratingCount: number;
  myScore: number | null;
  ratings?: { name: string; score: number }[];
  handedOff: boolean;
  skipped?: boolean;
}

export interface NowPlaying extends PublicEntry {
  isPlaying: boolean;
  progressMs: number;
  ageMs: number;
  canRate: boolean;
  skip: { needed: number; voters: string[]; mine: boolean; pending: boolean };
}

export interface AppState {
  connected: boolean;
  spotifyName: string | null;
  error: string | null;
  nowPlaying: NowPlaying | null;
  queue: PublicEntry[];
  history: PublicEntry[];
  leaderboard: { name: string; average: number; songs: number }[];
  playerPaused: boolean;
}

export interface User {
  id: string;
  name: string;
}

const USER_KEY = "songswap:user";

function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function useUser() {
  const [user, setUserState] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(USER_KEY);
      if (raw) setUserState(JSON.parse(raw));
    } catch {}
    setReady(true);
  }, []);

  const setName = useCallback((name: string) => {
    setUserState((prev) => {
      const next = { id: prev?.id ?? randomId(), name: name.trim().slice(0, 24) };
      localStorage.setItem(USER_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { user, ready, setName };
}

export function useAppState(userId: string | null, intervalMs = 3000) {
  const [state, setState] = useState<AppState | null>(null);
  const [receivedAt, setReceivedAt] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const inflight = useRef(false);

  const refresh = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      const res = await fetch(`/api/state${userId ? `?userId=${userId}` : ""}`, { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed to load");
      setState(j);
      setReceivedAt(Date.now());
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      inflight.current = false;
    }
  }, [userId]);

  useEffect(() => {
    refresh();
    const t = setInterval(() => {
      if (!document.hidden) refresh();
    }, intervalMs);
    const onVisible = () => !document.hidden && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh, intervalMs]);

  return { state, receivedAt, loadError, refresh };
}

export async function postJSON(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || "Something went wrong");
  return j;
}

export function fmtTime(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export const DEFAULT_ACCENT = "#1ed760";

/** Picks a vivid, readable-on-dark accent colour from an image (falls back to Spotify green). */
export function useAccentColor(src: string | null | undefined) {
  const [color, setColor] = useState(DEFAULT_ACCENT);
  useEffect(() => {
    if (!src) {
      setColor(DEFAULT_ACCENT);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      try {
        const c = document.createElement("canvas");
        c.width = c.height = 24;
        const ctx = c.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0, 24, 24);
        const d = ctx.getImageData(0, 0, 24, 24).data;
        // Weight pixels by saturation so we pick the "colourful" part of the cover, not the greys.
        let r = 0, g = 0, b = 0, w = 0;
        for (let i = 0; i < d.length; i += 4) {
          const max = Math.max(d[i], d[i + 1], d[i + 2]);
          const min = Math.min(d[i], d[i + 1], d[i + 2]);
          const weight = (max - min) / 255 + 0.02;
          r += d[i] * weight;
          g += d[i + 1] * weight;
          b += d[i + 2] * weight;
          w += weight;
        }
        const [h, s] = rgbToHsl(r / w, g / w, b / w);
        setColor(s < 0.12 ? DEFAULT_ACCENT : `hsl(${Math.round(h)} ${Math.round(Math.max(65, s * 100))}% 62%)`);
      } catch {
        setColor(DEFAULT_ACCENT);
      }
    };
    img.onerror = () => !cancelled && setColor(DEFAULT_ACCENT);
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);
  return color;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    setMatches(m.matches);
    const on = () => setMatches(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [query]);
  return matches;
}

export function fmtDuration(ms: number) {
  const m = Math.round(ms / 60000);
  if (m < 1) return "<1 min";
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** 1 → red, 10 → green. */
export function heat(score: number) {
  const t = Math.min(1, Math.max(0, (score - 1) / 9));
  return `hsl(${Math.round(t * 135)} 85% 58%)`;
}

export const SCORE_LABELS: Record<number, string> = {
  1: "Skip it 💀",
  2: "Oof 😬",
  3: "Not for me 😕",
  4: "Meh 😐",
  5: "It's fine 🙂",
  6: "Decent 👍",
  7: "Good one 😎",
  8: "Love it 🎶",
  9: "Banger 🔥",
  10: "Masterpiece 👑",
};

/** Ticks locally so the progress bar moves smoothly between polls. */
export function useProgress(np: NowPlaying | null, receivedAt: number) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 500);
    return () => clearInterval(t);
  }, []);
  if (!np) return 0;
  const elapsed = np.isPlaying ? np.ageMs + (Date.now() - receivedAt) : 0;
  return Math.min(np.track.durationMs, np.progressMs + elapsed);
}

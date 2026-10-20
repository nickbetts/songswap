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
}

export interface NowPlaying extends PublicEntry {
  isPlaying: boolean;
  progressMs: number;
  ageMs: number;
  canRate: boolean;
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

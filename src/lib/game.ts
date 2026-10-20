import { getKV, withLock } from "./store";
import * as sp from "./spotify";
import type { Track } from "./spotify";

const STATE_KEY = "ss:state";
const HANDOFF_REMAINING_MS = 25_000;
const MAX_HISTORY = 200;

export interface Person {
  id: string;
  name: string;
}

export interface Entry {
  id: string;
  track: Track;
  addedBy: Person;
  addedAt: number;
  handedOffAt?: number;
  startedAt?: number;
  ratings: Record<string, { name: string; score: number }>;
}

interface GameState {
  queue: Entry[];
  nowPlaying: Entry | null;
  history: Entry[];
  playback: sp.Playback | null;
  playbackAt: number;
  error: string | null;
}

const emptyState = (): GameState => ({
  queue: [],
  nowPlaying: null,
  history: [],
  playback: null,
  playbackAt: 0,
  error: null,
});

export class GameError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function load(): Promise<GameState> {
  return { ...emptyState(), ...((await getKV().get<GameState>(STATE_KEY)) ?? {}) };
}

async function save(s: GameState) {
  await getKV().set(STATE_KEY, s);
}

const forceSync = () => getKV().del("ss:sync");

export function cleanPerson(p: unknown): Person {
  const o = (p ?? {}) as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id.trim() : "";
  const name = typeof o.name === "string" ? o.name.trim().replace(/\s+/g, " ").slice(0, 24) : "";
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) throw new GameError(400, "Invalid user id");
  if (!name) throw new GameError(400, "Please enter a name");
  return { id, name };
}

export const average = (e: Entry) => {
  const scores = Object.values(e.ratings).map((r) => r.score);
  return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
};

export async function addSong(person: Person, trackId: string) {
  if (!/^[A-Za-z0-9]{10,32}$/.test(trackId)) throw new GameError(400, "Invalid track");
  // Fetch outside the lock so the lock is held briefly; re-check inside.
  const track = await sp.getTrack(trackId).catch((e) => {
    throw new GameError(404, e instanceof Error ? e.message : "Track not found");
  });
  await withLock("state", async () => {
    const s = await load();
    if (s.queue.some((e) => e.track.id === track.id) || s.nowPlaying?.track.id === track.id) {
      throw new GameError(409, "That song is already queued or playing");
    }
    s.queue.push({
      id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
      track,
      addedBy: person,
      addedAt: Date.now(),
      ratings: {},
    });
    await save(s);
  });
  await forceSync();
}

export async function rateSong(person: Person, entryId: string, score: number) {
  if (!Number.isInteger(score) || score < 1 || score > 10) throw new GameError(400, "Score must be 1-10");
  await withLock("state", async () => {
    const s = await load();
    const np = s.nowPlaying;
    if (!np || np.id !== entryId) throw new GameError(409, "That song is no longer playing");
    if (np.addedBy.id === person.id) throw new GameError(403, "You can't rate your own song");
    np.ratings[person.id] = { name: person.name, score };
    await save(s);
  });
}

export async function removeEntry(entryId: string) {
  await withLock("state", async () => {
    const s = await load();
    const e = s.queue.find((x) => x.id === entryId);
    if (!e) throw new GameError(404, "Not in the queue");
    if (e.handedOffAt) {
      throw new GameError(409, "Already sent to Spotify's queue. Skip it there or use Play now");
    }
    s.queue = s.queue.filter((x) => x.id !== entryId);
    await save(s);
  });
}

export async function playNow(entryId: string) {
  await withLock("state", async () => {
    const s = await load();
    const e = s.queue.find((x) => x.id === entryId);
    if (!e) throw new GameError(404, "Not in the queue");
    await sp.playUris([e.track.uri]);
    e.handedOffAt = Date.now();
    // Keep it first so it is matched as the now-playing track.
    s.queue = [e, ...s.queue.filter((x) => x.id !== entryId)];
    s.error = null;
    await save(s);
  });
  await forceSync();
}

export async function playerControl(action: "pause" | "resume" | "skip") {
  try {
    if (action === "pause") await sp.pause();
    else if (action === "resume") await sp.resume();
    else await sp.skipNext();
  } catch (e) {
    if (e instanceof sp.SpotifyError && e.status === 403) {
      throw new GameError(409, `Spotify refused to ${action} right now (already ${action === "resume" ? "playing" : "paused"}, or an ad is playing).`);
    }
    throw e;
  }
  await forceSync();
}

export async function resetAll() {
  await withLock("state", async () => save(emptyState()));
}

/**
 * Reconciles our queue with Spotify's player: detects which of our songs is playing,
 * and feeds the next song to Spotify shortly before the current one ends.
 * Throttled so many clients polling don't hammer Spotify.
 */
export async function sync() {
  if (!(await sp.getAuth())) return;
  if (!(await getKV().setNX("ss:sync", "1", 2500))) return;

  let pb: sp.Playback | null = null;
  try {
    pb = await sp.getPlayback();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Spotify error";
    await withLock("state", async () => {
      const s = await load();
      s.error = msg;
      await save(s);
    }).catch(() => {});
    return;
  }

  await withLock("state", async () => {
    const s = await load();
    const now = Date.now();
    s.playback = pb;
    s.playbackAt = now;
    s.error = null;

    const retire = () => {
      if (s.nowPlaying) {
        s.history.unshift(s.nowPlaying);
        s.history = s.history.slice(0, MAX_HISTORY);
        s.nowPlaying = null;
      }
    };

    if (pb?.trackId) {
      if (s.nowPlaying?.track.id !== pb.trackId) {
        retire();
        const idx = s.queue.findIndex((e) => e.track.id === pb!.trackId);
        if (idx >= 0) {
          const [e] = s.queue.splice(idx, 1);
          e.startedAt = now;
          s.nowPlaying = e;
        }
      }
    } else {
      retire();
    }

    const head = s.queue[0];
    if (head) {
      const idleOrEnded =
        !pb || (!pb.isPlaying && (pb.progressMs === 0 || pb.progressMs >= pb.durationMs - 3000));

      if (head.handedOffAt && !pb?.isPlaying && now - head.handedOffAt > 30_000) {
        head.handedOffAt = undefined;
      }

      if (!head.handedOffAt) {
        try {
          if (pb?.isPlaying && pb.durationMs - pb.progressMs < HANDOFF_REMAINING_MS) {
            await sp.addToSpotifyQueue(head.track.uri);
            head.handedOffAt = now;
            s.error = null;
          } else if (idleOrEnded) {
            await sp.playUris([head.track.uri]);
            head.handedOffAt = now;
            s.error = null;
          }
        } catch (e) {
          s.error =
            e instanceof sp.SpotifyError && e.status === 404
              ? "No Spotify device found. Make sure the Spotify app is open and logged in (and Private Session is off)."
              : e instanceof Error
                ? e.message
                : "Spotify error";
        }
      }
    }
    await save(s);
  }).catch(() => {});
}

function publicEntry(e: Entry, userId: string | null, showRatings: boolean) {
  const avg = average(e);
  return {
    id: e.id,
    track: e.track,
    addedBy: e.addedBy,
    addedAt: e.addedAt,
    average: avg,
    ratingCount: Object.keys(e.ratings).length,
    myScore: userId ? (e.ratings[userId]?.score ?? null) : null,
    ratings: showRatings ? Object.values(e.ratings).map((r) => ({ name: r.name, score: r.score })) : undefined,
    handedOff: !!e.handedOffAt,
  };
}

export async function publicState(userId: string | null, admin: boolean) {
  const auth = await sp.getAuth();
  const s = await load();
  const all = [...(s.nowPlaying ? [s.nowPlaying] : []), ...s.history];

  const byPerson = new Map<string, { name: string; sum: number; rated: number; songs: number }>();
  for (const e of all) {
    const p = byPerson.get(e.addedBy.id) ?? { name: e.addedBy.name, sum: 0, rated: 0, songs: 0 };
    p.name = e.addedBy.name;
    p.songs++;
    const avg = average(e);
    if (avg !== null) {
      p.sum += avg;
      p.rated++;
    }
    byPerson.set(e.addedBy.id, p);
  }
  const leaderboard = [...byPerson.values()]
    .filter((p) => p.rated > 0)
    .map((p) => ({ name: p.name, average: p.sum / p.rated, songs: p.songs }))
    .sort((a, b) => b.average - a.average);

  const pb = s.playback;
  const np = s.nowPlaying;
  return {
    connected: !!auth,
    spotifyName: admin ? (auth?.displayName ?? null) : null,
    error: s.error,
    nowPlaying: np
      ? {
          ...publicEntry(np, userId, false),
          isPlaying: !!pb?.isPlaying,
          progressMs: pb?.progressMs ?? 0,
          ageMs: pb?.isPlaying ? Date.now() - s.playbackAt : 0,
          canRate: !!userId && np.addedBy.id !== userId,
        }
      : null,
    queue: s.queue.map((e) => publicEntry(e, userId, false)),
    history: s.history.slice(0, 50).map((e) => publicEntry(e, userId, true)),
    leaderboard,
    playerPaused: !!pb && !pb.isPlaying,
  };
}

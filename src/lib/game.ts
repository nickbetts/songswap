import { randomInt } from "crypto";
import { getKV, withLock } from "./store";
import * as sp from "./spotify";
import type { Track } from "./spotify";

const STATE_KEY = "ss:state";
const HANDOFF_REMAINING_MS = 25_000;
const MAX_HISTORY = 200;
const STALL_MS = 60_000;
const TAKEOVER_GRACE_MS = 15_000;
export const SKIP_VOTES_NEEDED = 5;

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
  skipVotes?: Record<string, string>;
  skippedAt?: number;
}

interface GameState {
  queue: Entry[];
  nowPlaying: Entry | null;
  history: Entry[];
  playback: sp.Playback | null;
  playbackAt: number;
  pausedSince?: number | null;
  adminPaused?: boolean;
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

/** Toggles a person's vote to skip the current song; skips it once enough people agree. */
export async function voteSkip(person: Person, entryId: string, vote: boolean) {
  let skipped = false;
  await withLock("state", async () => {
    const s = await load();
    const np = s.nowPlaying;
    if (!np || np.id !== entryId) throw new GameError(409, "That song is no longer playing");
    if (np.skippedAt) throw new GameError(409, "Already skipping this one");
    np.skipVotes ??= {};
    if (vote) np.skipVotes[person.id] = person.name;
    else delete np.skipVotes[person.id];

    if (Object.keys(np.skipVotes).length >= SKIP_VOTES_NEEDED) {
      // Jump straight to our next song if Spotify doesn't already have it queued.
      const head = s.queue[0];
      try {
        if (head && !head.handedOffAt) {
          await sp.playUris([head.track.uri]);
          head.handedOffAt = Date.now();
        } else {
          await sp.skipNext();
        }
      } catch (e) {
        await save(s);
        throw new GameError(502, `Enough votes, but Spotify wouldn't skip: ${e instanceof Error ? e.message : "error"}`);
      }
      np.skippedAt = Date.now();
      s.adminPaused = false;
      s.error = null;
      skipped = true;
    }
    await save(s);
  });
  if (skipped) await forceSync();
  return { skipped };
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

/**
 * Reorders the queue to match `order` (entry ids). Songs already handed to Spotify stay
 * pinned at the front since Spotify's own queue can't be reordered; ids not in `order`
 * (e.g. added while the host was dragging) keep their relative order at the end.
 */
export async function reorderQueue(order: unknown) {
  if (!Array.isArray(order) || order.length > 500 || !order.every((x) => typeof x === "string")) {
    throw new GameError(400, "Invalid order");
  }
  await withLock("state", async () => {
    const s = await load();
    let pinnedCount = 0;
    while (pinnedCount < s.queue.length && s.queue[pinnedCount].handedOffAt) pinnedCount++;
    const pinned = s.queue.slice(0, pinnedCount);
    const rest = s.queue.slice(pinnedCount);
    const rank = new Map((order as string[]).map((id, i) => [id, i]));
    const key = (e: Entry, i: number) => rank.get(e.id) ?? order.length + i;
    const sorted = rest
      .map((e, i) => ({ e, k: key(e, i) }))
      .sort((a, b) => a.k - b.k)
      .map((x) => x.e);
    s.queue = [...pinned, ...sorted];
    await save(s);
  });
  await forceSync();
}

/** Host: shuffles Up Next. Songs already handed to Spotify stay pinned at the front. */
export async function shuffleQueue() {
  await withLock("state", async () => {
    const s = await load();
    let pinnedCount = 0;
    while (pinnedCount < s.queue.length && s.queue[pinnedCount].handedOffAt) pinnedCount++;
    const rest = s.queue.slice(pinnedCount);
    if (rest.length < 2) throw new GameError(409, "Not enough songs in Up Next to shuffle");
    for (let i = rest.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    s.queue = [...s.queue.slice(0, pinnedCount), ...rest];
    await save(s);
  });
  await forceSync();
}

export async function playNow(entryId: string) {
  await withLock("state", async () => {
    const s = await load();
    const e = s.queue.find((x) => x.id === entryId);
    if (!e) throw new GameError(404, "Not in the queue");
    await sp.playUris([e.track.uri]);
    s.adminPaused = false;
    e.handedOffAt = Date.now();
    // Keep it first so it is matched as the now-playing track.
    s.queue = [e, ...s.queue.filter((x) => x.id !== entryId)];
    s.error = null;
    await save(s);
  });
  await forceSync();
}

/** Starts the head of our queue on Spotify. Returns false if the queue is empty. */
async function playHead(): Promise<boolean> {
  return withLock("state", async () => {
    const s = await load();
    const head = s.queue[0];
    if (!head) return false;
    await sp.playUris([head.track.uri]);
    head.handedOffAt = Date.now();
    s.adminPaused = false;
    s.pausedSince = null;
    s.error = null;
    await save(s);
    return true;
  });
}

export async function playerControl(action: "pause" | "resume" | "skip") {
  const st = await withLock("state", async () => {
    const s = await load();
    s.adminPaused = action === "pause";
    await save(s);
    return s;
  });
  try {
    if (action === "pause") await sp.pause();
    else if (action === "resume") {
      // If Spotify isn't on one of our songs (e.g. after reconnecting, or it's idle), a plain
      // resume would restart whatever Spotify last had, so start our Up Next queue instead.
      if (!st.nowPlaying && (await playHead())) {
        await forceSync();
        return;
      }
      try {
        await sp.resume();
      } catch (e) {
        // Nothing for Spotify to resume (idle/new session): fall back to our queue.
        if (!(e instanceof sp.SpotifyError) || ![403, 404].includes(e.status) || !(await playHead())) throw e;
      }
    } else await sp.skipNext();
  } catch (e) {
    if (e instanceof sp.SpotifyError && e.status === 403) {
      throw new GameError(409, `Spotify refused to ${action} right now (already ${action === "resume" ? "playing" : "paused"}, or an ad is playing).`);
    }
    throw e;
  }
  await forceSync();
}

/** Host: removes a played song (and its scores) from history, which also updates the leaderboard. */
export async function deleteHistoryEntry(entryId: string) {
  await withLock("state", async () => {
    const s = await load();
    const before = s.history.length;
    s.history = s.history.filter((e) => e.id !== entryId);
    if (s.history.length === before) throw new GameError(404, "Not in the played history");
    await save(s);
  });
}

/** Host: removes one person's score from a played (or the currently playing) song. */
export async function deleteRating(entryId: string, raterId: string) {
  await withLock("state", async () => {
    const s = await load();
    const e = s.nowPlaying?.id === entryId ? s.nowPlaying : s.history.find((x) => x.id === entryId);
    if (!e) throw new GameError(404, "Song not found");
    if (!Object.hasOwn(e.ratings, raterId)) throw new GameError(404, "Score not found");
    delete e.ratings[raterId];
    await save(s);
  });
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

    if (pb?.isPlaying) s.pausedSince = null;
    else s.pausedSince ??= now;
    if (pb?.isPlaying) s.adminPaused = false;

    const head = s.queue[0];
    if (head) {
      const ended = !pb || (!pb.isPlaying && (pb.progressMs === 0 || pb.progressMs >= pb.durationMs - 3000));
      const stalled = !pb?.isPlaying && now - (s.pausedSince ?? now) > STALL_MS;

      // Something that isn't ours is playing (or nothing is), or our song ended / the player stalled:
      // take over and play the next song straight away.
      const foreign = !s.nowPlaying;
      const headPending = !!head.handedOffAt && now - head.handedOffAt <= TAKEOVER_GRACE_MS;
      const takeover =
        !s.adminPaused && ((foreign && !headPending) || (!!s.nowPlaying && !pb?.isPlaying && (ended || stalled)));

      try {
        if (takeover) {
          await sp.playUris([head.track.uri]);
          retire();
          head.handedOffAt = now;
          s.pausedSince = null;
        } else if (!head.handedOffAt && pb?.isPlaying && pb.durationMs - pb.progressMs < HANDOFF_REMAINING_MS) {
          await sp.addToSpotifyQueue(head.track.uri);
          head.handedOffAt = now;
        }
      } catch (e) {
        s.error =
          e instanceof sp.SpotifyError && e.status === 404 && !(e instanceof sp.DeviceUnavailableError)
            ? "No Spotify device found. Make sure the Spotify app is open and logged in (and Private Session is off)."
            : e instanceof Error
              ? e.message
              : "Spotify error";
      }
    }
    await save(s);
  }).catch(() => {});
}

function publicEntry(e: Entry, userId: string | null, showRatings: boolean, admin = false) {
  const avg = average(e);
  return {
    id: e.id,
    track: e.track,
    addedBy: e.addedBy,
    addedAt: e.addedAt,
    average: avg,
    ratingCount: Object.keys(e.ratings).length,
    myScore: userId ? (e.ratings[userId]?.score ?? null) : null,
    ratings: showRatings
      ? Object.entries(e.ratings).map(([id, r]) => ({ name: r.name, score: r.score, ...(admin ? { id } : {}) }))
      : undefined,
    handedOff: !!e.handedOffAt,
    skipped: !!e.skippedAt,
  };
}

export async function publicState(userId: string | null, admin: boolean) {
  const [auth, s, device] = await Promise.all([sp.getAuth(), load(), admin ? sp.getChosenDevice() : null]);
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
    device: admin ? { chosen: device?.name ?? null, current: s.playback?.deviceName ?? null } : null,
    error: s.error,
    nowPlaying: np
      ? {
          ...publicEntry(np, userId, false),
          isPlaying: !!pb?.isPlaying,
          progressMs: pb?.progressMs ?? 0,
          ageMs: pb?.isPlaying ? Date.now() - s.playbackAt : 0,
          canRate: !!userId && np.addedBy.id !== userId,
          skip: {
            needed: SKIP_VOTES_NEEDED,
            voters: Object.values(np.skipVotes ?? {}),
            mine: !!userId && !!np.skipVotes?.[userId],
            pending: !!np.skippedAt,
          },
        }
      : null,
    queue: s.queue.map((e) => publicEntry(e, userId, false)),
    history: s.history.slice(0, admin ? MAX_HISTORY : 50).map((e) => publicEntry(e, userId, true, admin)),
    leaderboard,
    playerPaused: !!pb && !pb.isPlaying,
  };
}

import { randomInt, randomUUID } from "crypto";
import { getKV, withLock } from "./store";
import * as sp from "./spotify";
import type { Track } from "./spotify";

const STATE_KEY = "ss:state";
const HISTORY_KEY = "ss:history";
const PLAYBACK_KEY = "ss:playback";
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
  roundNumber?: number;
}

interface RoundResult {
  number: number;
  songs: { entryId: string; person: Person; average: number | null }[];
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
  roundNumber: number;
  roundParticipants: string[];
  roundResults: RoundResult[];
}

const emptyState = (): GameState => ({
  queue: [],
  nowPlaying: null,
  history: [],
  playback: null,
  playbackAt: 0,
  error: null,
  roundNumber: 1,
  roundParticipants: [],
  roundResults: [],
});

export class GameError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/*
 * Persisted as three keys so the frequent polls/syncs stay cheap on the database:
 *  - ss:state    small core (queue, now playing, flags) + the current history version
 *  - ss:history  the (large) played history, re-read only when its version changes
 *  - ss:playback the Spotify player snapshot, rewritten on every sync
 * Each key is only written when its contents actually changed.
 */
type CoreState = Omit<GameState, "history" | "playback" | "playbackAt" | "roundResults"> & { historyVer?: string };
interface StoredHistory {
  ver: string;
  list: Entry[];
  rounds?: RoundResult[];
}
interface StoredPlayback {
  playback: sp.Playback | null;
  playbackAt: number;
}

let historyCache: StoredHistory | null = null;
const loaded = new WeakMap<GameState, { core: string; history: string; playback: string; historyVer?: string }>();

function split(s: GameState) {
  const { history, roundResults, playback, playbackAt, ...core } = s;
  const p: StoredPlayback = { playback, playbackAt };
  return { core, history: { list: history, rounds: roundResults }, playback: p };
}

async function loadHistory(ver: string | undefined): Promise<StoredHistory> {
  if (!ver) return { ver: "", list: [], rounds: [] };
  if (historyCache?.ver !== ver) {
    const h = await getKV().get<StoredHistory>(HISTORY_KEY);
    if (!h) throw new Error("Saved round history is missing");
    historyCache = h;
  }
  return structuredClone(historyCache);
}

async function load(): Promise<GameState> {
  const [stored, pb] = await Promise.all([
    getKV().get<CoreState & Partial<GameState>>(STATE_KEY),
    getKV().get<StoredPlayback>(PLAYBACK_KEY),
  ]);
  const { historyVer, history: legacyHistory, playback: legacyPb, playbackAt: legacyPbAt, ...core } = stored ?? {};
  // Older deployments kept everything (history + playback) inside ss:state.
  const legacy = !!legacyHistory;
  const history = legacy ? { list: legacyHistory, rounds: [] } : await loadHistory(historyVer);
  const s: GameState = {
    ...emptyState(),
    ...core,
    history: history.list,
    roundResults: history.rounds ?? [],
    playback: pb ? pb.playback : legacyPb ?? null,
    playbackAt: pb?.playbackAt ?? legacyPbAt ?? 0,
  };
  if (s.nowPlaying && s.nowPlaying.roundNumber === undefined) {
    s.nowPlaying.roundNumber = s.roundNumber;
    s.roundParticipants = [s.nowPlaying.addedBy.id];
  }
  applyFairOrder(s);
  const parts = split(s);
  loaded.set(s, {
    core: legacy ? "" : JSON.stringify(core),
    history: legacy ? "" : JSON.stringify(parts.history),
    playback: pb ? JSON.stringify(parts.playback) : "",
    historyVer: legacy ? undefined : historyVer,
  });
  return s;
}

async function save(s: GameState) {
  const kv = getKV();
  const prev = loaded.get(s);
  const parts = split(s);
  const core = JSON.stringify(parts.core);
  const history = JSON.stringify(parts.history);
  const playback = JSON.stringify(parts.playback);
  let historyVer = prev?.historyVer;

  if (history !== prev?.history || !historyVer) {
    historyVer = randomUUID();
    const h: StoredHistory = { ver: historyVer, ...parts.history };
    await kv.set(HISTORY_KEY, h);
    historyCache = structuredClone(h);
  }
  const writes: Promise<void>[] = [];
  if (core !== prev?.core || historyVer !== prev?.historyVer) {
    writes.push(kv.set(STATE_KEY, { ...parts.core, historyVer }));
  }
  if (playback !== prev?.playback) writes.push(kv.set(PLAYBACK_KEY, parts.playback));
  await Promise.all(writes);
  loaded.set(s, { core, history, playback, historyVer });
}

const forceSync = () => getKV().del("ss:sync");

export const average = (e: Entry) => {
  const scores = Object.values(e.ratings).map((r) => r.score);
  return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
};

/**
 * Round-robin Up Next so everyone gets a turn: each round plays one song per person, in the
 * order people first appear in the queue, and each person's own songs keep their order.
 * Songs already handed to Spotify stay pinned at the front. Whoever played last (the last
 * pinned song, else the current song) goes to the back of the first round so nobody gets
 * two in a row while others are waiting.
 */
export function fairOrder(queue: Entry[], current: Entry | null): Entry[] {
  let pinnedCount = 0;
  while (pinnedCount < queue.length && queue[pinnedCount].handedOffAt) pinnedCount++;
  const pinned = queue.slice(0, pinnedCount);
  const groups = new Map<string, Entry[]>();
  for (const e of queue.slice(pinnedCount)) {
    const list = groups.get(e.addedBy.id);
    if (list) list.push(e);
    else groups.set(e.addedBy.id, [e]);
  }
  const users = [...groups.keys()];
  const lastId = (pinned.at(-1) ?? current)?.addedBy.id;
  if (lastId && users.length > 1 && users.includes(lastId)) {
    users.splice(users.indexOf(lastId), 1);
    users.push(lastId);
  }
  const out = [...pinned];
  for (let round = 0; out.length < queue.length; round++) {
    for (const u of users) {
      const e = groups.get(u)![round];
      if (e) out.push(e);
    }
  }
  return out;
}

const applyFairOrder = (s: GameState) => {
  const used = new Map<number, Set<string>>([[s.roundNumber, new Set(s.roundParticipants)]]);
  const groups = new Map<number, Entry[]>();
  for (const e of s.queue) {
    let round = s.roundNumber;
    while (used.get(round)?.has(e.addedBy.id)) round++;
    const people = used.get(round) ?? new Set<string>();
    people.add(e.addedBy.id);
    used.set(round, people);
    e.roundNumber = round;
    const group = groups.get(round) ?? [];
    group.push(e);
    groups.set(round, group);
  }
  let previous = s.nowPlaying ?? s.history[0] ?? null;
  s.queue = [...groups.keys()].sort((a, b) => a - b).flatMap((round) => {
    let group = groups.get(round)!;
    if (round > s.roundNumber || !s.roundParticipants.length) group = fairOrder(group, previous);
    previous = group.at(-1)!;
    return group;
  });
};

function finishRound(s: GameState) {
  if (s.nowPlaying || !s.roundParticipants.length || s.queue.some((e) => e.roundNumber === s.roundNumber)) return;
  s.roundResults.push({
    number: s.roundNumber,
    songs: s.history.filter((e) => e.roundNumber === s.roundNumber)
      .map((e) => ({ entryId: e.id, person: e.addedBy, average: average(e) })),
  });
  s.roundNumber++;
  s.roundParticipants = [];
  applyFairOrder(s);
}

function winners(result: RoundResult) {
  const rated = result.songs.filter((song) => song.average !== null);
  const best = Math.max(...rated.map((song) => song.average!));
  return rated.filter((song) => song.average === best);
}

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
    applyFairOrder(s);
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
          await sp.playTrack(head.track);
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
    s.queue = s.queue.filter((x) => x.id !== entryId);
    s.error = null;
    applyFairOrder(s);
    await save(s);
  });
  await forceSync();
}

/**
 * Reorders the queue to match `order` (entry ids), then re-applies the fair rotation: the
 * dragged order decides who goes first in each round and which of a person's songs plays
 * first. Songs already handed to Spotify stay pinned at the front since Spotify's own queue
 * can't be reordered; ids not in `order` (e.g. added mid-drag) keep their relative order.
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
      .sort((a, b) => a.e.roundNumber! - b.e.roundNumber! || a.k - b.k)
      .map((x) => x.e);
    s.queue = [...pinned, ...sorted];
    applyFairOrder(s);
    await save(s);
  });
  await forceSync();
}

/**
 * Host: shuffles Up Next while keeping it fair (random turn order and random pick of each
 * person's songs). Songs already handed to Spotify stay pinned at the front.
 */
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
    applyFairOrder(s);
    await save(s);
  });
  await forceSync();
}

export async function playNow(entryId: string) {
  await withLock("state", async () => {
    const s = await load();
    const e = s.queue.find((x) => x.id === entryId);
    if (!e) throw new GameError(404, "Not in the queue");
    if (e.roundNumber !== s.roundNumber) {
      throw new GameError(409, "That person already has a song in this round. Play it when their next round begins");
    }
    await sp.playTrack(e.track);
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
    await sp.playTrack(head.track);
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
    for (const round of s.roundResults) {
      round.songs = round.songs.filter((song) => song.entryId !== entryId);
    }
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
    for (const round of s.roundResults) {
      const song = round.songs.find((song) => song.entryId === entryId);
      if (song) song.average = average(e);
    }
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
    });
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
        s.history = s.history.filter((entry, index) => index < MAX_HISTORY || entry.roundNumber === s.roundNumber);
        s.nowPlaying = null;
      }
    };

    const matchesPlayback = (entry: Entry) =>
      entry.track.id === pb?.trackId ||
      (!!pb?.linkedFromId && entry.track.id === pb.linkedFromId) ||
      (!!pb?.isrc && !!entry.track.isrc && entry.track.isrc.toUpperCase() === pb.isrc.toUpperCase());
    if (pb?.isrc) {
      const candidates = [
        ...(s.nowPlaying ? [s.nowPlaying] : []),
        ...s.queue.filter((entry) => entry.handedOffAt),
      ];
      for (const entry of candidates) {
        if (!matchesPlayback(entry) && entry.track.isrc === undefined) {
          // Existing queue entries predate recording codes; resolve once and persist it.
          entry.track.isrc = (await sp.getTrack(entry.track.id)).isrc ?? null;
        }
      }
    }
    if (pb?.trackId || pb?.linkedFromId) {
      if (!s.nowPlaying || !matchesPlayback(s.nowPlaying)) {
        retire();
        applyFairOrder(s);
        finishRound(s);
        const idx = s.queue.findIndex((e) => matchesPlayback(e) && e.roundNumber === s.roundNumber);
        if (idx >= 0) {
          const [e] = s.queue.splice(idx, 1);
          e.startedAt = now;
          s.nowPlaying = e;
          s.roundParticipants.push(e.addedBy.id);
        }
      }
    } else {
      retire();
    }

    applyFairOrder(s);
    finishRound(s);

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
        if (foreign && head.handedOffAt && !headPending) {
          s.error = pb
            ? `Spotify has not confirmed the requested song. Reported track: ${pb.trackId ?? "unknown"}${pb.linkedFromId ? ` (linked from ${pb.linkedFromId})` : ""}. Expected: ${head.track.id}. Use Play now to retry; automatic retries are stopped to avoid restarting playback.`
            : "Spotify accepted the song request but is not reporting playback. Check the selected device and Private Session, then use Play now to retry. Automatic retries are stopped to avoid restarting playback.";
        } else if (takeover) {
          await sp.playTrack(head.track);
          retire();
          head.handedOffAt = now;
          s.pausedSince = null;
        } else if (head.roundNumber === s.roundNumber && !head.handedOffAt && pb?.isPlaying && pb.durationMs - pb.progressMs < HANDOFF_REMAINING_MS) {
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
  });
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
    roundNumber: e.roundNumber ?? null,
  };
}

export async function publicState(userId: string | null, admin: boolean) {
  const [auth, s, device] = await Promise.all([sp.getAuth(), load(), admin ? sp.getChosenDevice() : null]);
  const all = [...(s.nowPlaying ? [s.nowPlaying] : []), ...s.history];

  const byPerson = new Map<string, { id: string; name: string; sum: number; rated: number; songs: number; roundPoints: number }>();
  for (const e of all) {
    const p = byPerson.get(e.addedBy.id) ?? { ...e.addedBy, sum: 0, rated: 0, songs: 0, roundPoints: 0 };
    p.name = e.addedBy.name;
    p.songs++;
    const avg = average(e);
    if (avg !== null) {
      p.sum += avg;
      p.rated++;
    }
    byPerson.set(e.addedBy.id, p);
  }
  for (const round of s.roundResults) {
    for (const song of winners(round)) {
      const p = byPerson.get(song.person.id) ?? { ...song.person, sum: 0, rated: 0, songs: 0, roundPoints: 0 };
      p.roundPoints++;
      byPerson.set(p.id, p);
    }
  }
  const leaderboard = [...byPerson.values()]
    .filter((p) => p.rated > 0 || p.roundPoints > 0)
    .map((p) => ({ id: p.id, name: p.name, average: p.rated ? p.sum / p.rated : null, songs: p.songs, roundPoints: p.roundPoints }))
    .sort((a, b) => b.roundPoints - a.roundPoints || (b.average ?? 0) - (a.average ?? 0) || a.name.localeCompare(b.name));

  const pb = s.playback;
  const np = s.nowPlaying;
  return {
    currentRound: s.roundNumber,
    roundResults: s.roundResults.map((round) => ({
      number: round.number,
      winners: winners(round).map((song) => ({ ...song.person, average: song.average! })),
      songCount: round.songs.length,
    })),
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

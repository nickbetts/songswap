"use client";

import { useEffect, useState } from "react";
import {
  NowPlaying,
  PublicEntry,
  AppState,
  TrackInfo,
  User,
  fmtTime,
  postJSON,
  useProgress,
} from "./hooks";

export function Art({ src, size = 48 }: { src: string | null; size?: number }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="art" src={src} width={size} height={size} alt="" />
  ) : (
    <div className="art placeholder" style={{ width: size, height: size }} />
  );
}

export function NowPlayingCard({
  np,
  receivedAt,
  user,
  onChange,
}: {
  np: NowPlaying | null;
  receivedAt: number;
  user: User | null;
  onChange: () => void;
}) {
  const progress = useProgress(np, receivedAt);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState<number | null>(null);

  useEffect(() => {
    setErr(null);
    setPending(null);
  }, [np?.id]);

  if (!np) {
    return (
      <section className="card">
        <h2>Now playing</h2>
        <p className="muted">Nothing from the queue is playing yet. Add a song below!</p>
      </section>
    );
  }

  const mine = user?.id === np.addedBy.id;
  const score = pending ?? np.myScore;

  async function rate(n: number) {
    if (!user) return;
    setPending(n);
    setErr(null);
    try {
      await postJSON("/api/rate", { user, entryId: np!.id, score: n });
      onChange();
    } catch (e) {
      setPending(null);
      setErr(e instanceof Error ? e.message : "Could not rate");
    }
  }

  return (
    <section className="card now">
      <h2>Now playing {!np.isPlaying && <span className="pill">paused</span>}</h2>
      <div className="row">
        <Art src={np.track.image} size={96} />
        <div className="grow">
          <div className="title">{np.track.name}</div>
          <div className="muted">{np.track.artists}</div>
          <div className="muted small">
            Picked by <strong>{mine ? "you" : np.addedBy.name}</strong>
          </div>
        </div>
        <div className="avg">
          <div className="big">{np.average !== null ? np.average.toFixed(1) : "–"}</div>
          <div className="muted small">
            {np.ratingCount} {np.ratingCount === 1 ? "vote" : "votes"}
          </div>
        </div>
      </div>
      <div className="bar">
        <div className="fill" style={{ width: `${(progress / Math.max(1, np.track.durationMs)) * 100}%` }} />
      </div>
      <div className="times muted small">
        <span>{fmtTime(progress)}</span>
        <span>{fmtTime(np.track.durationMs)}</span>
      </div>

      {np.canRate ? (
        <div>
          <div className="vote-note">
            🗳️ Voting is open until the song finishes
            {np.isPlaying ? ` · ${fmtTime(np.track.durationMs - progress)} left` : " · paused"}
          </div>
          <div className="muted small">Rate this song{score ? ` (you gave ${score})` : ""}</div>
          <div className="scores">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <button key={n} className={`score ${score === n ? "active" : ""}`} onClick={() => rate(n)}>
                {n}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p className="muted small">
          {mine ? "This is your song. Sit back and wait for the votes!" : "Guests can rate this song"}
          {" · voting closes when it finishes"}
          {np.isPlaying ? ` (${fmtTime(np.track.durationMs - progress)} left)` : ""}
        </p>
      )}
      {err && <p className="error">{err}</p>}
    </section>
  );
}

export function SearchAdd({
  user,
  disabled,
  onAdded,
}: {
  user: User | null;
  disabled: boolean;
  onAdded: () => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<TrackInfo[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`, { signal: ctrl.signal });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error);
        setResults(j.tracks);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setMsg({ ok: false, text: (e as Error).message || "Search failed" });
      }
    }, 350);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  async function add(t: TrackInfo) {
    setBusy(t.id);
    setMsg(null);
    try {
      await postJSON("/api/queue", { user, trackId: t.id });
      setMsg({ ok: true, text: `Added "${t.name}" to the queue` });
      setQ("");
      setResults([]);
      onAdded();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Could not add" });
    } finally {
      setBusy(null);
    }
  }

  const locked = disabled || !user;

  return (
    <section className="card">
      <h2>Add a song</h2>
      <input
        className="input"
        placeholder="Search for a song or artist…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        disabled={!user}
      />
      {msg && <p className={msg.ok ? "ok" : "error"}>{msg.text}</p>}
      <ul className="list">
        {results.map((t) => (
          <li key={t.id} className="row">
            <Art src={t.image} />
            <div className="grow">
              <div className="title">{t.name}</div>
              <div className="muted small">{t.artists}</div>
            </div>
            <button className="btn" disabled={locked || busy !== null} onClick={() => add(t)}>
              {busy === t.id ? "…" : "Add"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function QueueList({
  queue,
  userId,
  actions,
}: {
  queue: PublicEntry[];
  userId: string | null;
  actions?: (e: PublicEntry) => React.ReactNode;
}) {
  return (
    <section className="card">
      <h2>Up next ({queue.length})</h2>
      {queue.length === 0 ? (
        <p className="muted">The queue is empty.</p>
      ) : (
        <ol className="list">
          {queue.map((e, i) => (
            <li key={e.id} className="row">
              <span className="muted idx">{i + 1}</span>
              <Art src={e.track.image} />
              <div className="grow">
                <div className="title">{e.track.name}</div>
                <div className="muted small">
                  {e.track.artists} · {e.addedBy.id === userId ? "you" : e.addedBy.name}
                  {e.handedOff && " · up next on Spotify"}
                </div>
              </div>
              {actions?.(e)}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function Leaderboard({ rows }: { rows: AppState["leaderboard"] }) {
  if (!rows.length) return null;
  return (
    <section className="card">
      <h2>Leaderboard</h2>
      <ol className="list">
        {rows.map((r, i) => (
          <li key={r.name + i} className="row">
            <span className="muted idx">{i === 0 ? "🏆" : i + 1}</span>
            <div className="grow title">{r.name}</div>
            <span className="muted small">
              {r.songs} {r.songs === 1 ? "song" : "songs"}
            </span>
            <strong>{r.average.toFixed(2)}</strong>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function History({ items, userId }: { items: PublicEntry[]; userId: string | null }) {
  if (!items.length) return null;
  return (
    <section className="card">
      <h2>Played</h2>
      <ul className="list">
        {items.map((e) => (
          <li key={e.id} className="row top">
            <Art src={e.track.image} />
            <div className="grow">
              <div className="title">{e.track.name}</div>
              <div className="muted small">
                {e.track.artists} · {e.addedBy.id === userId ? "you" : e.addedBy.name}
              </div>
              {!!e.ratings?.length && (
                <div className="chips">
                  {e.ratings.map((r, i) => (
                    <span key={i} className="chip">
                      {r.name} {r.score}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="avg small">
              <strong>{e.average !== null ? e.average.toFixed(1) : "–"}</strong>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, Reorder, motion, useDragControls } from "motion/react";
import { toast } from "sonner";
import {
  Check,
  Clock,
  Crown,
  Disc3,
  GripVertical,
  History as HistoryIcon,
  ListMusic,
  Lock,
  Music2,
  Plus,
  Search,
  SkipForward,
  Sparkles,
  Trash2,
  Trophy,
  X,
} from "lucide-react";
import {
  AppState,
  NowPlaying,
  PublicEntry,
  SCORE_LABELS,
  TrackInfo,
  User,
  fmtDuration,
  fmtTime,
  heat,
  postJSON,
  useProgress,
} from "./hooks";
import { Art, Avatar, Equalizer, Kbd, ScoreBadge, ScoreRing, Spinner } from "./ui";
import { RecordDeck, SignalBars } from "./listening-room";

export { Art } from "./ui";

async function burst(el: Element | null, opts: { count?: number; spread?: number; colors?: string[] } = {}) {
  const confetti = (await import("canvas-confetti")).default;
  const r = el?.getBoundingClientRect();
  confetti({
    particleCount: opts.count ?? 60,
    spread: opts.spread ?? 70,
    startVelocity: 32,
    ticks: 180,
    scalar: 0.9,
    zIndex: 9999,
    disableForReducedMotion: true,
    colors: opts.colors,
    origin: r
      ? { x: (r.left + r.width / 2) / window.innerWidth, y: (r.top + r.height / 2) / window.innerHeight }
      : { y: 0.6 },
  });
}

/* ───────────────────────────── Now playing ───────────────────────────── */

export function NowPlayingHero({
  np,
  receivedAt,
  user,
  onChange,
  onRequest,
  canRequest = true,
  controls,
  effects = true,
}: {
  np: NowPlaying | null;
  receivedAt: number;
  user: User | null;
  onChange: () => void;
  onRequest: () => void;
  canRequest?: boolean;
  controls?: React.ReactNode;
  effects?: boolean;
}) {
  const progress = useProgress(np, receivedAt);
  const [pending, setPending] = useState<number | null>(null);

  useEffect(() => setPending(null), [np?.id]);

  if (!np) {
    return (
      <section className="hero glass hero-empty">
        <div className="hero-media">
          <RecordDeck image={null} playing={false} effects={effects} />
        </div>
        <div className="hero-body">
          <div className="eyebrow">
            <Equalizer playing={false} /> Now playing
          </div>
          <h2 className="hero-title">Every great night<br />starts with a song.</h2>
          <p className="hero-artist">The deck is yours. Find something worth sharing.</p>
          <div>
            <button className="btn btn-lg" onClick={onRequest} disabled={!canRequest}>
              <Plus size={20} strokeWidth={2.6} /> Request the first song
            </button>
          </div>
          {controls}
        </div>
      </section>
    );
  }

  const mine = user?.id === np.addedBy.id;
  const score = pending ?? np.myScore;
  const remaining = np.track.durationMs - progress;
  const pct = (progress / Math.max(1, np.track.durationMs)) * 100;

  async function rate(n: number, el: HTMLElement) {
    if (!user) return;
    const prev = pending;
    setPending(n);
    if (n >= 9) burst(el, { count: n === 10 ? 120 : 50, colors: [heat(n), "#ffffff", "#ffd54a"] });
    try {
      await postJSON("/api/rate", { entryId: np!.id, score: n });
      onChange();
    } catch (e) {
      setPending(prev);
      toast.error(e instanceof Error ? e.message : "Could not rate");
    }
  }

  return (
    <section className={`hero glass ${np.isPlaying ? "is-playing" : ""}`}>
      <div className="stage-watermark" aria-hidden="true">ON AIR</div>
      <div className="hero-media">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={np.id}
            className="deck-transition"
            initial={{ opacity: 0, scale: 0.8, rotate: -6, x: 40 }}
            animate={{ opacity: 1, scale: 1, rotate: 0, x: 0 }}
            exit={{ opacity: 0, scale: 0.85, x: -60 }}
            transition={{ type: "spring", stiffness: 120, damping: 18 }}
          >
            <RecordDeck image={np.track.image} playing={np.isPlaying} progress={pct} effects={effects} />
          </motion.div>
        </AnimatePresence>
        <div className="deck-caption"><span className={`dot ${np.isPlaying ? "live" : ""}`} /> SIDE A <span>THE PEOPLE&apos;S SELECTION</span></div>
      </div>

      <div className="hero-body">
        <div className="stage-eyebrow">
          <span className="stage-live"><Equalizer playing={np.isPlaying} /> {np.isPlaying ? "ON THE DECK" : "ON PAUSE"}</span>
          <span className="stage-format">SPOTIFY / SHARED SESSION</span>
        </div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={np.id}
            className="hero-text"
            initial={{ opacity: 0, y: 14, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -10, filter: "blur(6px)" }}
            transition={{ duration: 0.35 }}
          >
            <h2 className="hero-title" title={np.track.name}>
              {np.track.name}
              {np.track.explicit && <span className="explicit">E</span>}
            </h2>
            <div className="hero-artist">{np.track.artists}</div>
            <div className="picked-by">
              <Avatar name={np.addedBy.name} size={24} />
              <span>
                Picked by <strong className={mine ? "accent" : ""}>{mine ? "you" : np.addedBy.name}</strong>
              </span>
            </div>
          </motion.div>
        </AnimatePresence>

        <div className="progress" role="progressbar" aria-label="Track progress" aria-valuemin={0} aria-valuemax={Math.round(np.track.durationMs / 1000)} aria-valuenow={Math.round(progress / 1000)} aria-valuetext={`${fmtTime(progress)} of ${fmtTime(np.track.durationMs)}`}>
          <div className="bar">
            <div className="fill" style={{ width: `${pct}%` }}>
              <span className="knob" />
            </div>
          </div>
          <div className="times">
            <span>{fmtTime(progress)}</span>
            <span>-{fmtTime(remaining)}</span>
          </div>
        </div>

        {np.canRate ? (
          <RatingPad score={score} onRate={rate} remaining={remaining} playing={np.isPlaying} />
        ) : mine ? (
          <div className="mine-note">
            <Sparkles size={18} />
            <span>
              This one&apos;s yours — sit back and soak up the votes.{" "}
              <span className="muted">Voting closes when it ends.</span>
            </span>
          </div>
        ) : null}
        <SkipVote np={np} user={user} onChange={onChange} />
        {controls}
      </div>

      <div className="hero-score">
        <ScoreRing value={np.average} count={np.ratingCount} />
        <span className="hero-score-cap">Crowd score</span>
        <SignalBars playing={np.isPlaying && effects} />
        <span className="ambient-caption">AMBIENT VISUAL</span>
      </div>
    </section>
  );
}

function RatingPad({
  score,
  onRate,
  remaining,
  playing,
}: {
  score: number | null;
  onRate: (n: number, el: HTMLElement) => void;
  remaining: number;
  playing: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? score;
  return (
    <div className="rate">
      <div className="rate-head">
        <span className="rate-title">
          {score ? "Your rating" : "Rate this song"}
          <span className="vote-chip">
            <span className={`dot ${playing ? "live" : ""}`} />
            {playing ? `closes in ${fmtTime(remaining)}` : "paused"}
          </span>
        </span>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={shown ?? 0}
            className="rate-label"
            style={{ color: shown ? heat(shown) : undefined }}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
          >
            {shown ? SCORE_LABELS[shown] : "Tap a number"}
          </motion.span>
        </AnimatePresence>
      </div>
      <div className="scores" onMouseLeave={() => setHover(null)}>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <motion.button
            key={n}
            className={`score ${score === n ? "active" : ""} ${score && n <= score ? "lit" : ""}`}
            style={{ "--c": heat(n) } as React.CSSProperties}
            whileHover={{ y: -3 }}
            whileTap={{ scale: 0.86 }}
            onMouseEnter={() => setHover(n)}
            onFocus={() => setHover(n)}
            onBlur={() => setHover(null)}
            onClick={(e) => onRate(n, e.currentTarget)}
            aria-label={`Rate ${n} out of 10`}
            aria-pressed={score === n}
          >
            {score === n && (
              <motion.span layoutId="score-pick" className="score-pick" transition={{ type: "spring", stiffness: 500, damping: 32 }} />
            )}
            <span className="score-n">{n}</span>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

function SkipVote({ np, user, onChange }: { np: NowPlaying; user: User | null; onChange: () => void }) {
  const [pending, setPending] = useState<boolean | null>(null);
  useEffect(() => setPending(null), [np.id]);

  const { needed, voters, mine: serverMine, pending: skipping } = np.skip;
  const mine = pending ?? serverMine;
  const count = Math.min(needed, voters.length + (mine === serverMine ? 0 : mine ? 1 : -1));
  const left = needed - count;

  async function toggle() {
    if (!user || skipping) return;
    const next = !mine;
    setPending(next);
    try {
      const r = await postJSON("/api/skip", { entryId: np.id, vote: next });
      if (r.skipped) toast("Skipped by popular vote 👋", { description: np.track.name });
      onChange();
    } catch (e) {
      setPending(null);
      toast.error(e instanceof Error ? e.message : "Could not vote");
      onChange();
    }
  }

  return (
    <div className={`skipvote ${mine ? "on" : ""} ${skipping ? "going" : ""}`}>
      <motion.button
        className="skip-btn"
        whileTap={{ scale: 0.95 }}
        onClick={toggle}
        disabled={!user || skipping}
        title={mine ? "Tap to take back your vote" : `${needed} votes skips this song`}
        aria-pressed={mine}
      >
        <SkipForward size={15} fill={mine ? "currentColor" : "none"} />
        {skipping ? "Skipping…" : mine ? "Voted to skip" : "Vote to skip"}
      </motion.button>
      <div className="skip-meter" aria-label={`${count} of ${needed} skip votes`}>
        {Array.from({ length: needed }, (_, i) => (
          <motion.span
            key={i}
            className={`pip ${i < count ? "on" : ""}`}
            animate={{ scale: i < count ? 1 : 0.85 }}
            transition={{ type: "spring", stiffness: 500, damping: 20 }}
          />
        ))}
      </div>
      <span className="skip-text">
        {skipping ? "Next song coming up" : count === 0 ? `${needed} votes skips it` : `${left} more to skip`}
      </span>
      {voters.length > 0 && (
        <span className="skip-voters" title={voters.join(", ")}>
          {voters.slice(0, 5).map((n, i) => (
            <Avatar key={n + i} name={n} size={22} />
          ))}
        </span>
      )}
    </div>
  );
}

/* ───────────────────────────── Request a song ───────────────────────────── */

const SUGGESTIONS = ["Mr. Brightside", "Dancing Queen", "Daft Punk", "Fleetwood Mac", "Kendrick Lamar", "Oasis"];

export function RequestPanel({
  user,
  disabled,
  queuedIds,
  queueLength,
  myQueued,
  onAdded,
  inputRef,
  autoFocus,
  onClose,
}: {
  user: User | null;
  disabled: boolean;
  queuedIds: Set<string>;
  queueLength: number;
  myQueued: number;
  onAdded: () => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  autoFocus?: boolean;
  onClose?: () => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<TrackInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [justAdded, setJustAdded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const localRef = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? localRef;

  useEffect(() => {
    const query = q.trim();
    setError(null);
    if (query.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: ctrl.signal });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error);
        setResults(j.tracks);
        setLoading(false);
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          setError((e as Error).message || "Search failed");
          setLoading(false);
        }
      }
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  async function add(t: TrackInfo, el: HTMLElement) {
    if (!user) return;
    setBusy(t.id);
    try {
      await postJSON("/api/queue", { trackId: t.id });
      setJustAdded((s) => new Set(s).add(t.id));
      burst(el, { count: 40, spread: 55 });
      toast.success(`Requested “${t.name}”`, {
        description: `${t.artists} · #${queueLength + 1} in the queue`,
        icon: <Art src={t.image} size={32} />,
      });
      onAdded();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add");
    } finally {
      setBusy(null);
    }
  }

  const query = q.trim();

  return (
    <section className="panel glass request" id="request">
      <header className="panel-head">
        <div className="panel-title">
          <span className="panel-icon hot">
            <Plus size={18} strokeWidth={2.8} />
          </span>
          <div>
            <h2>Request a song</h2>
            <p className="panel-sub">
              {myQueued > 0
                ? `You've got ${myQueued} in the queue — add as many as you like`
                : "Search Spotify and drop it in the queue"}
            </p>
          </div>
        </div>
        {onClose && (
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        )}
      </header>

      <div className={`search ${disabled ? "is-disabled" : ""}`}>
        <Search size={20} className="search-icon" />
        <input
          ref={ref}
          className="search-input"
          placeholder={disabled ? "Requests open once the host connects Spotify" : "Song, artist or album…"}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              if (q) setQ("");
              else onClose?.();
            }
          }}
          disabled={disabled || !user}
          autoFocus={autoFocus}
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
        />
        {loading ? (
          <Spinner size={18} />
        ) : q ? (
          <button className="icon-btn sm" onClick={() => (setQ(""), ref.current?.focus())} aria-label="Clear search">
            <X size={16} />
          </button>
        ) : (
          !onClose && <Kbd>/</Kbd>
        )}
      </div>

      <div className="results">
        {error && <p className="error">{error}</p>}

        {query.length < 2 && !disabled && (
          <div className="suggest">
            <span className="muted small">Need inspiration?</span>
            <div className="chips">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="chip-btn" onClick={() => (setQ(s), ref.current?.focus())}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {loading && results.length === 0 && (
          <ul className="list">
            {Array.from({ length: 5 }, (_, i) => (
              <li key={i} className="skeleton-row">
                <span className="sk sk-art" />
                <span className="sk-lines">
                  <span className="sk sk-line" />
                  <span className="sk sk-line short" />
                </span>
              </li>
            ))}
          </ul>
        )}

        {!loading && query.length >= 2 && results.length === 0 && !error && (
          <p className="empty-mini">No matches for “{query}”. Try another spelling?</p>
        )}

        <ul className={`list ${loading ? "dim" : ""}`}>
          <AnimatePresence initial={false}>
            {results.map((t, i) => {
              const queued = queuedIds.has(t.id) || justAdded.has(t.id);
              return (
                <motion.li
                  key={t.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ delay: i * 0.03 }}
                >
                  <button
                    className={`result ${queued ? "queued" : ""}`}
                    disabled={disabled || !user || busy !== null || queued}
                    onClick={(e) => add(t, e.currentTarget.querySelector(".add-dot") ?? e.currentTarget)}
                  >
                    <Art src={t.image} size={48} />
                    <span className="grow">
                      <span className="title">
                        {t.name}
                        {t.explicit && <span className="explicit">E</span>}
                      </span>
                      <span className="sub">
                        {t.artists} · {fmtTime(t.durationMs)}
                      </span>
                    </span>
                    <span className={`add-dot ${queued ? "done" : ""}`}>
                      {busy === t.id ? (
                        <Spinner size={16} />
                      ) : queued ? (
                        <Check size={18} strokeWidth={3} />
                      ) : (
                        <Plus size={18} strokeWidth={3} />
                      )}
                    </span>
                  </button>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      </div>
    </section>
  );
}

/* ───────────────────────────── Queue ───────────────────────────── */

export function QueuePanel({
  queue,
  np,
  receivedAt,
  userId,
  actions,
  onRequest,
  canRequest = true,
  onReorder,
}: {
  queue: PublicEntry[];
  np: NowPlaying | null;
  receivedAt: number;
  userId: string | null;
  actions?: (e: PublicEntry) => React.ReactNode;
  onRequest: () => void;
  canRequest?: boolean;
  onReorder?: (ids: string[]) => Promise<void>;
}) {
  const progress = useProgress(np, receivedAt);
  // While the host is dragging (or the save is in flight) we show the local order, not polled state.
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  const dragging = useRef(false);
  const latestIds = useRef<string[]>([]);

  const total = queue.reduce((a, e) => a + e.track.durationMs, 0);
  let pinnedCount = 0;
  while (pinnedCount < queue.length && queue[pinnedCount].handedOff) pinnedCount++;
  const pinned = queue.slice(0, pinnedCount);
  const movableById = new Map(queue.slice(pinnedCount).map((e) => [e.id, e]));
  const movableIds = localOrder
    ? [...localOrder.filter((id) => movableById.has(id)), ...[...movableById.keys()].filter((id) => !localOrder.includes(id))]
    : [...movableById.keys()];
  const ordered = [...pinned, ...movableIds.map((id) => movableById.get(id)!)];
  latestIds.current = movableIds;
  const serverKey = queue.slice(pinnedCount).map((e) => e.id).join();

  // Once polled state matches what the host dropped (or after a timeout), go back to server order.
  useEffect(() => {
    if (!localOrder || dragging.current) return;
    if (serverKey === latestIds.current.join()) {
      setLocalOrder(null);
      return;
    }
    const t = setTimeout(() => !dragging.current && setLocalOrder(null), 5000);
    return () => clearTimeout(t);
  }, [serverKey, localOrder]);

  const etas: number[] = [];
  let eta = np ? Math.max(0, np.track.durationMs - progress) : 0;
  for (const e of ordered) {
    etas.push(eta);
    eta += e.track.durationMs;
  }

  async function commit() {
    dragging.current = false;
    const ids = latestIds.current;
    if (!onReorder || serverKey === ids.join()) {
      setLocalOrder(null);
      return;
    }
    try {
      await onReorder(ids);
    } catch {
      setLocalOrder(null);
    }
  }

  const row = (e: PublicEntry, i: number, handle?: React.ReactNode) => (
    <QueueRowBody e={e} i={i} at={etas[i]} showEta={!!np} mine={e.addedBy.id === userId} handle={handle} actions={actions} />
  );

  return (
    <section className="panel glass">
      <header className="panel-head">
        <div className="panel-title">
          <span className="panel-icon">
            <ListMusic size={18} />
          </span>
          <div>
            <h2>
              Up next <span className="count">{queue.length}</span>
            </h2>
            <p className="panel-sub">
              {queue.length
                ? `${fmtDuration(total)} lined up · one song per person, in turns${onReorder && queue.length > 1 ? " · drag to change turn order" : ""}`
                : "Nothing queued"}
            </p>
          </div>
        </div>
      </header>

      {queue.length === 0 ? (
        <div className="empty">
          <Disc3 size={40} className="empty-icon" />
          <p>The queue is empty.</p>
          <button className="btn ghost" onClick={onRequest} disabled={!canRequest}>
            <Plus size={16} /> Add a song
          </button>
        </div>
      ) : onReorder ? (
        <div className="list queue">
          {pinned.map((e, i) => (
            <div key={e.id} className={`qrow ${e.addedBy.id === userId ? "mine" : ""} ${i === 0 ? "first" : ""}`}>
              {row(e, i, <span className="drag-handle locked" title="Already sent to Spotify — can’t be moved"><Lock size={14} /></span>)}
            </div>
          ))}
          <Reorder.Group
            as="ol"
            axis="y"
            values={movableIds}
            onReorder={setLocalOrder}
            className="list"
          >
            {movableIds.map((id, k) => {
              const e = movableById.get(id)!;
              return (
                <DraggableQueueRow
                  key={id}
                  id={id}
                  className={`qrow ${e.addedBy.id === userId ? "mine" : ""} ${pinnedCount + k === 0 ? "first" : ""}`}
                  onStart={() => {
                    dragging.current = true;
                    setLocalOrder(movableIds);
                  }}
                  onEnd={commit}
                >
                  {(handle) => row(e, pinnedCount + k, handle)}
                </DraggableQueueRow>
              );
            })}
          </Reorder.Group>
        </div>
      ) : (
        <ol className="list queue">
          <AnimatePresence initial={false}>
            {ordered.map((e, i) => (
              <motion.li
                key={e.id}
                layout
                initial={{ opacity: 0, y: 16, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: -30, transition: { duration: 0.2 } }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                className={`qrow ${e.addedBy.id === userId ? "mine" : ""} ${i === 0 ? "first" : ""}`}
              >
                {row(e, i)}
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      )}
    </section>
  );
}

function DraggableQueueRow({
  id,
  className,
  onStart,
  onEnd,
  children,
}: {
  id: string;
  className: string;
  onStart: () => void;
  onEnd: () => void;
  children: (handle: React.ReactNode) => React.ReactNode;
}) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={id}
      className={className}
      dragListener={false}
      dragControls={controls}
      onDragStart={onStart}
      onDragEnd={onEnd}
      whileDrag={{ scale: 1.03, boxShadow: "0 18px 40px -12px rgba(0,0,0,0.7)", zIndex: 5 }}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 400, damping: 34 }}
    >
      {children(
        <span
          className="drag-handle"
          title="Drag to reorder"
          aria-label="Drag to reorder"
          onPointerDown={(e) => {
            e.preventDefault();
            controls.start(e);
          }}
        >
          <GripVertical size={18} />
        </span>,
      )}
    </Reorder.Item>
  );
}

function QueueRowBody({
  e,
  i,
  at,
  showEta,
  mine,
  handle,
  actions,
}: {
  e: PublicEntry;
  i: number;
  at: number;
  showEta: boolean;
  mine: boolean;
  handle?: React.ReactNode;
  actions?: (e: PublicEntry) => React.ReactNode;
}) {
  return (
    <>
      {handle}
      <span className="qpos">{i + 1}</span>
      <Art src={e.track.image} size={44} />
      <div className="grow">
        <div className="title">
          {e.track.name}
          {e.track.explicit && <span className="explicit">E</span>}
        </div>
        <div className="sub">{e.track.artists}</div>
        <div className="meta">
          <span className="who">
            <Avatar name={e.addedBy.name} size={16} />
            {mine ? "You" : e.addedBy.name}
          </span>
          {e.handedOff ? <span className="tag next">Locked in</span> : i === 0 ? <span className="tag next">Next</span> : null}
          {showEta && (
            <span className="eta">
              <Clock size={11} /> {at < 60000 ? "soon" : `~${fmtDuration(at)}`}
            </span>
          )}
        </div>
      </div>
      {actions?.(e)}
    </>
  );
}

/* ───────────────────────────── Leaderboard / Played ───────────────────────────── */

export interface HistoryAdmin {
  onDelete: (e: PublicEntry) => void;
  onDeleteRating: (e: PublicEntry, raterId: string, raterName: string) => void;
}

export function SidePanel({
  leaderboard,
  history,
  userId,
  userName,
  historyAdmin,
}: {
  leaderboard: AppState["leaderboard"];
  history: PublicEntry[];
  userId: string | null;
  userName: string | null;
  historyAdmin?: HistoryAdmin;
}) {
  const [tab, setTab] = useState<"board" | "played">("board");
  return (
    <section className="panel glass">
      <div className="tabs" role="tablist">
        {(
          [
            ["board", "Leaderboard", Trophy, leaderboard.length],
            ["played", "Played", HistoryIcon, history.length],
          ] as const
        ).map(([key, label, Icon, n]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            className={`tab ${tab === key ? "on" : ""}`}
            onClick={() => setTab(key)}
          >
            {tab === key && <motion.span layoutId="tab-pill" className="tab-pill" transition={{ type: "spring", stiffness: 400, damping: 34 }} />}
            <Icon size={16} />
            <span>{label}</span>
            {n > 0 && <span className="count">{n}</span>}
          </button>
        ))}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tab}
          initial={{ opacity: 0, x: tab === "board" ? -16 : 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: tab === "board" ? 16 : -16 }}
          transition={{ duration: 0.18 }}
        >
          {tab === "board" ? (
            <Leaderboard rows={leaderboard} me={userName} />
          ) : (
            <History items={history} userId={userId} admin={historyAdmin} />
          )}
        </motion.div>
      </AnimatePresence>
    </section>
  );
}

const MEDALS = ["#ffd54a", "#cfd8dc", "#e0a06a"];

export function Leaderboard({ rows, me }: { rows: AppState["leaderboard"]; me: string | null }) {
  if (!rows.length) {
    return (
      <div className="empty">
        <Trophy size={40} className="empty-icon" />
        <p>No scores yet. Rate songs to crown the best taste in the room.</p>
      </div>
    );
  }
  return (
    <ol className="list board">
      {rows.map((r, i) => (
        <motion.li
          key={r.name}
          layout
          className={`brow ${i < 3 ? "top" : ""} ${me && r.name === me ? "mine" : ""}`}
          style={{ "--medal": MEDALS[i] ?? "var(--muted)" } as React.CSSProperties}
        >
          <span className="rank">{i === 0 ? <Crown size={18} /> : i + 1}</span>
          <Avatar name={r.name} size={34} ring={i === 0} />
          <div className="grow">
            <div className="title">
              {r.name}
              {me && r.name === me && <span className="you-tag">you</span>}
            </div>
            <div className="bscore">
              <motion.span
                className="bscore-fill"
                initial={{ width: 0 }}
                animate={{ width: `${r.average * 10}%` }}
                transition={{ type: "spring", stiffness: 60, damping: 16, delay: i * 0.05 }}
                style={{ background: heat(r.average) }}
              />
            </div>
          </div>
          <div className="bnum">
            <strong style={{ color: heat(r.average) }}>{r.average.toFixed(2)}</strong>
            <span className="sub">
              {r.songs} {r.songs === 1 ? "song" : "songs"}
            </span>
          </div>
        </motion.li>
      ))}
    </ol>
  );
}

export function History({ items, userId, admin }: { items: PublicEntry[]; userId: string | null; admin?: HistoryAdmin }) {
  if (!items.length) {
    return (
      <div className="empty">
        <Music2 size={40} className="empty-icon" />
        <p>Songs land here with their scores once they finish.</p>
      </div>
    );
  }
  return (
    <ul className="list played">
      {items.map((e) => (
        <li key={e.id} className="hrow">
          <Art src={e.track.image} size={44} />
          <div className="grow">
            <div className="title">
              {e.track.name}
              {e.skipped && <span className="tag skipped">Skipped</span>}
            </div>
            <div className="sub">
              {e.track.artists} · {e.addedBy.id === userId ? "you" : e.addedBy.name}
            </div>
            {!!e.ratings?.length && (
              <div className="chips">
                {e.ratings.map((r, i) => (
                  <span key={i} className="chip" style={{ "--c": heat(r.score) } as React.CSSProperties}>
                    <Avatar name={r.name} size={16} /> {r.name} <b>{r.score}</b>
                    {admin && r.id && (
                      <button
                        className="chip-x"
                        title={`Delete ${r.name}’s score`}
                        aria-label={`Delete ${r.name}’s score`}
                        onClick={() => admin.onDeleteRating(e, r.id!, r.name)}
                      >
                        <X size={12} />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            )}
          </div>
          <ScoreBadge value={e.average} />
          {admin && (
            <button className="icon-btn sm danger" title="Delete from history" aria-label={`Delete ${e.track.name} from history`} onClick={() => admin.onDelete(e)}>
              <Trash2 size={16} />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/* ───────────────────────────── Overlays ───────────────────────────── */

export function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  const controls = useDragControls();
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="scrim"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.div
            className="sheet"
            role="dialog"
            aria-modal
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 38 }}
            drag="y"
            dragControls={controls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 120 || info.velocity.y > 600) onClose();
            }}
          >
            <div className="sheet-handle" onPointerDown={(e) => controls.start(e)}>
              <span />
            </div>
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export function PasswordForm({
  forced = false,
  onDone,
  onCancel,
}: {
  forced?: boolean;
  onDone: (user: User) => void;
  onCancel?: () => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (next !== confirmPw) return setErr("New passwords don’t match");
    setBusy(true);
    try {
      const j = await postJSON("/api/user", { action: "changePassword", current, password: next });
      toast.success("Password updated");
      onDone(j.user);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not change password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <div className="row">
        <span className="step-icon">
          <Lock size={18} />
        </span>
        <div className="grow">
          <h3>{forced ? "Set a new password" : "Change password"}</h3>
          <p className="muted small">
            {forced ? "You’re using the temporary password. Choose your own to continue." : "At least 6 characters."}
          </p>
        </div>
      </div>
      <input
        className="input"
        type="password"
        autoComplete="current-password"
        placeholder={forced ? "Temporary password" : "Current password"}
        autoFocus
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
      />
      <input
        className="input"
        type="password"
        autoComplete="new-password"
        placeholder="New password"
        minLength={6}
        value={next}
        onChange={(e) => setNext(e.target.value)}
      />
      <input
        className="input"
        type="password"
        autoComplete="new-password"
        placeholder="Confirm new password"
        value={confirmPw}
        onChange={(e) => setConfirmPw(e.target.value)}
      />
      {err && <p className="error">{err}</p>}
      <div className="row end">
        {onCancel && (
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button className="btn" disabled={busy || !current || next.length < 6 || !confirmPw}>
          {busy ? <Spinner size={18} /> : "Save password"}
        </button>
      </div>
    </form>
  );
}

export function PasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <div className="dialog-wrap">
            <motion.div
              className="dialog glass"
              role="dialog"
              aria-modal
              onKeyDown={(e) => e.key === "Escape" && onClose()}
              initial={{ opacity: 0, scale: 0.92, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
            >
              <PasswordForm onDone={onClose} onCancel={onClose} />
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}

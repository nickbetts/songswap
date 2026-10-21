"use client";

import { motion, useReducedMotion, useSpring } from "motion/react";
import { ArrowUpRight, Disc3, MoveUpRight } from "lucide-react";
import { PublicEntry, fmtDuration } from "./hooks";
import { Art, Avatar } from "./ui";

/** Decorative, not an audio analyser: Spotify doesn't expose the playing audio. */
export function SignalBars({ playing }: { playing: boolean }) {
  return (
    <span className={`signal-bars ${playing ? "playing" : ""}`} aria-hidden="true">
      {Array.from({ length: 36 }, (_, i) => (
        <i
          key={i}
          style={{
            height: `${18 + ((i * 17 + 11) % 67)}%`,
            animationDelay: `${(i % 9) * -0.19}s`,
            animationDuration: `${0.8 + (i % 7) * 0.17}s`,
          }}
        />
      ))}
    </span>
  );
}

export function RecordDeck({
  image,
  playing,
  progress = 0,
  effects = true,
}: {
  image: string | null;
  playing: boolean;
  progress?: number;
  effects?: boolean;
}) {
  const reduced = useReducedMotion();
  const rotateX = useSpring(0, { stiffness: 100, damping: 24 });
  const rotateY = useSpring(0, { stiffness: 100, damping: 24 });
  const active = playing && effects;

  return (
    <div className={`record-scene ${active ? "playing" : ""}`} aria-hidden="true">
      <div className="record-halo" />
      <motion.div
        className="record-deck"
        style={{ rotateX, rotateY }}
        onPointerMove={(e) => {
          if (reduced || !effects || e.pointerType !== "mouse") return;
          const r = e.currentTarget.getBoundingClientRect();
          rotateX.set((0.5 - (e.clientY - r.top) / r.height) * 12);
          rotateY.set(((e.clientX - r.left) / r.width - 0.5) * 12);
        }}
        onPointerLeave={() => {
          rotateX.set(0);
          rotateY.set(0);
        }}
      >
        <svg className="record-orbit" viewBox="0 0 400 400">
          <circle className="orbit-track" cx="200" cy="200" r="188" />
          <circle className="orbit-ticks" cx="200" cy="200" r="180" />
          <circle
            className="orbit-progress"
            cx="200"
            cy="200"
            r="188"
            pathLength="100"
            strokeDasharray={`${Math.min(100, Math.max(0, progress))} 100`}
            transform="rotate(-90 200 200)"
          />
        </svg>
        <div className="record-platter">
          <div className="record-disc">
            <div className="record-label">
              <Art src={image} size={160} />
              {!image && <Disc3 size={44} />}
            </div>
          </div>
          <div className="record-sheen" />
          <span className="record-spindle" />
        </div>
        <div className="tonearm"><span /></div>
        {image && <Art src={image} size={140} className="record-sleeve" />}
        <span className="deck-serial">SS / 33⅓</span>
        <span className="deck-light" />
      </motion.div>
    </div>
  );
}

export function RoomIntro({ queue, played }: { queue: PublicEntry[]; played: number }) {
  const duration = queue.reduce((sum, e) => sum + e.track.durationMs, 0);
  return (
    <div className="room-intro">
      <div>
        <p className="room-kicker"><span /> A SHARED LISTENING EXPERIENCE</p>
        <h1>Your taste. <span>On rotation.</span></h1>
      </div>
      <div className="room-stats">
        <div><strong>{String(queue.length).padStart(2, "0")}</strong><span>in the queue</span></div>
        <div><strong>{queue.length ? fmtDuration(duration) : "—"}</strong><span>still to come</span></div>
        <div><strong>{String(played).padStart(2, "0")}</strong><span>recent plays</span></div>
      </div>
    </div>
  );
}

export function NextTrack({ entry, onRequest, canRequest }: {
  entry: PublicEntry | undefined;
  onRequest: () => void;
  canRequest: boolean;
}) {
  return (
    <div className="next-track glass">
      <span className="next-track-label"><MoveUpRight size={15} /> ON THE HORIZON</span>
      {entry ? (
        <div className="next-track-song">
          <Art src={entry.track.image} size={42} />
          <div className="grow">
            <div className="title">{entry.track.name}</div>
            <div className="sub">{entry.track.artists}</div>
          </div>
          <span className="next-track-person"><Avatar name={entry.addedBy.name} size={22} /> {entry.addedBy.name}</span>
        </div>
      ) : <span className="muted small">The next great pick could be yours.</span>}
      <button className="next-track-add" onClick={onRequest} disabled={!canRequest}>
        Add your pick <ArrowUpRight size={17} />
      </button>
    </div>
  );
}

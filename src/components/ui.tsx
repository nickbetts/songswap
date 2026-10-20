"use client";

import { useEffect } from "react";
import { AnimatePresence, motion, useSpring, useTransform } from "motion/react";
import { heat } from "./hooks";

export function Art({ src, size = 48, className = "" }: { src: string | null; size?: number; className?: string }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img className={`art ${className}`} src={src} width={size} height={size} alt="" loading="lazy" />
  ) : (
    <div className={`art placeholder ${className}`} style={{ width: size, height: size }} />
  );
}

function hashHue(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function Avatar({ name, size = 24, ring = false }: { name: string; size?: number; ring?: boolean }) {
  const hue = hashHue(name.toLowerCase());
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?";
  return (
    <span
      className={`avatar ${ring ? "ring" : ""}`}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        background: `linear-gradient(135deg, hsl(${hue} 70% 55%), hsl(${(hue + 40) % 360} 70% 40%))`,
      }}
      aria-hidden
    >
      {initials}
    </span>
  );
}

export function Equalizer({ playing, bars = 4 }: { playing: boolean; bars?: number }) {
  return (
    <span className={`eq ${playing ? "on" : ""}`} aria-hidden>
      {Array.from({ length: bars }, (_, i) => (
        <i key={i} style={{ animationDelay: `${i * -0.23}s` }} />
      ))}
    </span>
  );
}

export function AnimatedNumber({ value, decimals = 1 }: { value: number; decimals?: number }) {
  const spring = useSpring(value, { stiffness: 120, damping: 20 });
  const text = useTransform(spring, (v) => v.toFixed(decimals));
  useEffect(() => spring.set(value), [spring, value]);
  return <motion.span>{text}</motion.span>;
}

export function ScoreRing({ value, count, size = 108 }: { value: number | null; count: number; size?: number }) {
  const r = size / 2 - 7;
  const color = value === null ? "var(--line-strong)" : heat(value);
  return (
    <div className="ring-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-track" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={7}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          initial={{ pathLength: 0 }}
          animate={{ pathLength: value === null ? 0 : value / 10, stroke: color }}
          transition={{ type: "spring", stiffness: 60, damping: 16 }}
          style={{ filter: value === null ? undefined : `drop-shadow(0 0 6px ${color})` }}
        />
      </svg>
      <div className="ring-label">
        <div className="ring-value" style={{ color: value === null ? "var(--muted)" : color }}>
          {value === null ? "–" : <AnimatedNumber value={value} />}
        </div>
        <div className="ring-sub">
          {count} {count === 1 ? "vote" : "votes"}
        </div>
      </div>
    </div>
  );
}

export function ScoreBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="score-badge empty">–</span>;
  return (
    <span className="score-badge" style={{ color: heat(value), borderColor: heat(value) }}>
      {value.toFixed(1)}
    </span>
  );
}

/** Blurred album art + drifting colour blobs behind the whole app. */
export function Backdrop({ image }: { image: string | null }) {
  return (
    <div className="backdrop" aria-hidden>
      <AnimatePresence>
        {image && (
          <motion.div
            key={image}
            className="backdrop-art"
            style={{ backgroundImage: `url(${image})` }}
            initial={{ opacity: 0, scale: 1.5 }}
            animate={{ opacity: 0.42, scale: 1.35 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.6, ease: "easeOut" }}
          />
        )}
      </AnimatePresence>
      <div className="blob b1" />
      <div className="blob b2" />
      <div className="blob b3" />
      <div className="grain" />
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-label="Loading" />;
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Disc3, Plus, Radio } from "lucide-react";
import { AppState, PublicEntry, User, useAccentColor, useMediaQuery } from "./hooks";
import { NowPlayingHero, QueuePanel, RequestPanel, Sheet, SidePanel } from "./parts";
import { Avatar, Backdrop, Kbd } from "./ui";

export function Logo({ spinning = false }: { spinning?: boolean }) {
  return (
    <a href="/" className="logo">
      <span className={`logo-disc ${spinning ? "spin" : ""}`}>
        <Disc3 size={22} />
      </span>
      <span className="logo-text">
        Song<span>Swap</span>
      </span>
    </a>
  );
}

/** Tints the whole UI with a colour pulled from the current album art. */
export function Themed({ image, children }: { image: string | null; children: React.ReactNode }) {
  const accent = useAccentColor(image);
  return (
    <div className="app" style={{ "--accent": accent } as React.CSSProperties}>
      <Backdrop image={image} />
      {children}
    </div>
  );
}

export function Dashboard({
  user,
  state,
  receivedAt,
  loadError,
  refresh,
  onEditName,
  badge,
  headerExtra,
  top,
  heroControls,
  queueActions,
  onReorder,
  bottom,
}: {
  user: User;
  state: AppState | null;
  receivedAt: number;
  loadError: string | null;
  refresh: () => void;
  onEditName?: () => void;
  badge?: React.ReactNode;
  headerExtra?: React.ReactNode;
  top?: React.ReactNode;
  heroControls?: React.ReactNode;
  queueActions?: (e: PublicEntry) => React.ReactNode;
  onReorder?: (ids: string[]) => Promise<void>;
  bottom?: React.ReactNode;
}) {
  const np = state?.nowPlaying ?? null;
  const queue = state?.queue ?? [];
  const wide = useMediaQuery("(min-width: 820px)");
  const [sheet, setSheet] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const queuedIds = useMemo(
    () => new Set([...queue.map((e) => e.track.id), ...(np ? [np.track.id] : [])]),
    [queue, np],
  );
  const myQueued = queue.filter((e) => e.addedBy.id === user.id).length;
  const canRequest = !!state?.connected;

  const openRequest = useCallback(() => {
    if (wide) {
      const el = inputRef.current;
      el?.closest(".request")?.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => el?.focus({ preventScroll: true }), 250);
    } else {
      setSheet(true);
    }
  }, [wide]);

  useEffect(() => {
    if (wide) setSheet(false);
  }, [wide]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key !== "/" || e.metaKey || e.ctrlKey || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      e.preventDefault();
      openRequest();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openRequest]);

  const requestProps = {
    user,
    disabled: !canRequest,
    queuedIds,
    queueLength: queue.length,
    myQueued,
    onAdded: refresh,
  };

  return (
    <Themed image={np?.track.image ?? null}>
      <header className="topbar">
        <div className="topbar-in">
          <div className="row">
            <Logo spinning={!!np?.isPlaying} />
            {badge}
          </div>
          <div className="row gap-sm">
            <span className={`status ${state?.connected ? "live" : ""}`}>
              <Radio size={14} />
              <span className="hide-sm">{state?.connected ? "Live" : "Offline"}</span>
            </span>
            <button className="btn btn-cta hide-sm" onClick={openRequest} disabled={!canRequest}>
              <Plus size={18} strokeWidth={2.8} /> Request a song <Kbd>/</Kbd>
            </button>
            {onEditName ? (
              <button className="user-chip" onClick={onEditName} title="Change your name">
                <Avatar name={user.name} size={26} />
                <span className="user-name">{user.name}</span>
              </button>
            ) : (
              <span className="user-chip static">
                <Avatar name={user.name} size={26} />
                <span className="user-name">{user.name}</span>
              </span>
            )}
            {headerExtra}
          </div>
        </div>
      </header>

      <main className="shell">
        <AnimatePresence>
          {(loadError || (state && (!state.connected || state.error))) && (
            <motion.div
              className="banner"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
            >
              <AlertTriangle size={18} />
              <span>
                {loadError
                  ? loadError
                  : !state?.connected
                    ? "The host hasn’t connected Spotify yet — requests open as soon as they do."
                    : `Waiting on the host’s Spotify: ${state?.error}`}
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {top}

        <NowPlayingHero
          np={np}
          receivedAt={receivedAt}
          user={user}
          onChange={refresh}
          onRequest={openRequest}
          canRequest={canRequest}
          controls={heroControls}
        />

        <div className="grid">
          {wide && (
            <div className="col-request">
              <RequestPanel {...requestProps} inputRef={inputRef} />
            </div>
          )}
          <div className="col-queue">
            <QueuePanel
              queue={queue}
              np={np}
              receivedAt={receivedAt}
              userId={user.id}
              actions={queueActions}
              onRequest={openRequest}
              canRequest={canRequest}
              onReorder={onReorder}
            />
          </div>
          <div className="col-side">
            <SidePanel
              leaderboard={state?.leaderboard ?? []}
              history={state?.history ?? []}
              userId={user.id}
              userName={user.name}
            />
          </div>
        </div>

        {bottom}
      </main>

      {!wide && (
        <>
          <div className="dock">
            <motion.button
              className="btn btn-cta dock-btn"
              onClick={openRequest}
              disabled={!canRequest}
              whileTap={{ scale: 0.96 }}
              initial={{ y: 80 }}
              animate={{ y: 0 }}
              transition={{ type: "spring", stiffness: 260, damping: 24, delay: 0.3 }}
            >
              <Plus size={22} strokeWidth={2.8} /> Request a song
              {myQueued > 0 && <span className="dock-count">{myQueued} queued</span>}
            </motion.button>
          </div>
          <Sheet open={sheet} onClose={() => setSheet(false)}>
            <RequestPanel {...requestProps} autoFocus onClose={() => setSheet(false)} />
          </Sheet>
        </>
      )}
    </Themed>
  );
}

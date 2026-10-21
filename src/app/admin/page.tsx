"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { ArrowLeft, Link2, Lock, LogOut, Pause, Play, PlayCircle, RotateCcw, Shuffle, SkipForward, Trash2, Unplug } from "lucide-react";
import { Dashboard, Logo, Themed } from "@/components/shell";
import { postJSON, useAppState, type User } from "@/components/hooks";
import { Spinner } from "@/components/ui";

const HOST: User = { id: "host-nick-0001", name: "Nick" };

export default function Admin() {
  const [admin, setAdmin] = useState<boolean | null>(null);
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { state, receivedAt, loadError, refresh } = useAppState(!!admin);

  useEffect(() => {
    fetch("/api/admin/login")
      .then((r) => r.json())
      .then((j) => setAdmin(!!j.admin))
      .catch(() => setAdmin(false));
    const p = new URLSearchParams(location.search);
    if (p.get("connected")) toast.success("Spotify connected!");
    else if (p.get("error")) toast.error(`Spotify error: ${p.get("error")}`);
    if (p.size) history.replaceState(null, "", "/admin");
  }, []);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      await postJSON("/api/admin/login", { password: pw });
      setAdmin(true);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Failed");
    }
  }

  async function act(action: string, extra: Record<string, unknown> = {}, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    const key = action + (extra.entryId ?? "");
    setBusy(key);
    try {
      await postJSON("/api/admin/action", { action, ...extra });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(null);
    }
    refresh();
  }

  if (admin === null) return null;

  if (!admin) {
    return (
      <Themed image={null}>
        <main className="join">
          <motion.form
            className="join-card glass narrow"
            onSubmit={login}
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 140, damping: 20 }}
          >
            <Logo />
            <h1 className="join-title sm">Host login</h1>
            <p className="muted">Sign in to connect Spotify and run the decks.</p>
            <label className="field">
              <span className="field-label">Admin password</span>
              <span className="field-row">
                <Lock size={18} className="muted" />
                <input
                  className="input bare"
                  type="password"
                  autoFocus
                  placeholder="••••••••"
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                />
              </span>
            </label>
            {msg && <p className="error">{msg}</p>}
            <button className="btn btn-lg btn-cta" disabled={!pw}>
              Sign in
            </button>
          </motion.form>
          <footer className="foot">
            <a href="/">
              <ArrowLeft size={14} /> Back to Song Swap
            </a>
          </footer>
        </main>
      </Themed>
    );
  }

  const np = state?.nowPlaying ?? null;
  const playing = !!np?.isPlaying;

  return (
    <Dashboard
      user={state?.me ?? HOST}
      state={state}
      receivedAt={receivedAt}
      loadError={loadError}
      refresh={refresh}
      badge={<span className="host-badge">Host</span>}
      headerExtra={
        <button
          className="icon-btn"
          title="Sign out"
          aria-label="Sign out"
          onClick={async () => {
            await postJSON("/api/admin/login", { logout: true });
            setAdmin(false);
          }}
        >
          <LogOut size={18} />
        </button>
      }
      top={
        <section className="hostbar glass">
          <div className="row grow">
            <span className={`conn-dot ${state?.connected ? "on" : ""}`} />
            <div className="grow">
              <div className="title">
                {state?.connected ? `Spotify connected${state.spotifyName ? ` as ${state.spotifyName}` : ""}` : "Spotify not connected"}
              </div>
              <div className="sub">
                {state?.connected
                  ? "Keep Spotify open on a device (Premium). Requests are fed in near the end of each track."
                  : "Connect the Spotify account you want to play through."}
              </div>
            </div>
          </div>
          <div className="row wrap-row gap-sm">
            {state?.connected ? (
              <>
                <a className="btn ghost sm" href="/api/auth/login">
                  <Link2 size={15} /> Reconnect
                </a>
                <button className="btn ghost sm" onClick={() => act("disconnect", {}, "Disconnect Spotify?")}>
                  <Unplug size={15} /> Disconnect
                </button>
              </>
            ) : (
              <a className="btn btn-cta" href="/api/auth/login">
                <Link2 size={16} /> Connect Spotify
              </a>
            )}
          </div>
        </section>
      }
      heroControls={
        state?.connected && (
          <div className="transport">
            <motion.button
              className="t-btn main"
              whileTap={{ scale: 0.9 }}
              onClick={() => act(playing ? "pause" : "resume")}
              aria-label={playing ? "Pause" : "Play"}
            >
              {busy === "pause" || busy === "resume" ? <Spinner size={20} /> : playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}
            </motion.button>
            <motion.button className="t-btn" whileTap={{ scale: 0.9 }} onClick={() => act("skip")} aria-label="Skip">
              {busy === "skip" ? <Spinner size={18} /> : <SkipForward size={20} fill="currentColor" />}
            </motion.button>
            <motion.button
              className="t-btn"
              whileTap={{ scale: 0.9 }}
              onClick={() => act("shuffle")}
              disabled={(state?.queue.filter((e) => !e.handedOff).length ?? 0) < 2}
              title="Shuffle Up Next"
              aria-label="Shuffle Up Next"
            >
              {busy === "shuffle" ? <Spinner size={18} /> : <Shuffle size={20} />}
            </motion.button>
            <span className="muted small">Host controls</span>
          </div>
        )
      }
      onReorder={async (order) => {
        try {
          await postJSON("/api/admin/action", { action: "reorder", order });
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Could not reorder");
          throw err;
        } finally {
          refresh();
        }
      }}
      historyAdmin={{
        onDelete: (e) => act("deleteHistory", { entryId: e.id }, `Delete “${e.track.name}” and all its scores from the history?`),
        onDeleteRating: (e, raterId, name) =>
          act("deleteRating", { entryId: e.id, raterId }, `Delete ${name}’s score for “${e.track.name}”?`),
      }}
      queueActions={(e) => (
        <div className="row-actions">
          <button
            className="icon-btn sm accent"
            title="Play now"
            aria-label="Play now"
            onClick={() => act("playNow", { entryId: e.id })}
          >
            {busy === "playNow" + e.id ? <Spinner size={14} /> : <PlayCircle size={18} />}
          </button>
          {!e.handedOff && (
            <button
              className="icon-btn sm danger"
              title="Remove"
              aria-label="Remove"
              onClick={() => act("remove", { entryId: e.id })}
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      )}
      bottom={
        <>
          <section className="danger-zone glass">
            <div>
              <div className="title">Danger zone</div>
              <div className="sub">Clears the queue, history and every rating.</div>
            </div>
            <button className="btn ghost danger-btn" onClick={() => act("reset", {}, "Clear the queue, history and all ratings?")}>
              <RotateCcw size={16} /> Reset session
            </button>
          </section>
          <footer className="foot">
            <a href="/">
              <ArrowLeft size={14} /> Guest view
            </a>
          </footer>
        </>
      }
    />
  );
}

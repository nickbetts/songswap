"use client";

import { useEffect, useState } from "react";
import { NowPlayingCard, QueueList, History } from "@/components/parts";
import { postJSON, useAppState } from "@/components/hooks";

export default function Admin() {
  const [admin, setAdmin] = useState<boolean | null>(null);
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const { state, receivedAt, refresh } = useAppState(admin ? "admin-view" : null);

  useEffect(() => {
    fetch("/api/admin/login")
      .then((r) => r.json())
      .then((j) => setAdmin(!!j.admin))
      .catch(() => setAdmin(false));
    const p = new URLSearchParams(location.search);
    if (p.get("connected")) setFlash({ ok: true, text: "Spotify connected!" });
    else if (p.get("error")) setFlash({ ok: false, text: `Spotify error: ${p.get("error")}` });
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
    try {
      await postJSON("/api/admin/action", { action, ...extra });
      setFlash(null);
    } catch (err) {
      setFlash({ ok: false, text: err instanceof Error ? err.message : "Failed" });
    }
    refresh();
  }

  if (admin === null) return null;

  if (!admin) {
    return (
      <main className="wrap">
        <header className="head">
          <h1>🎧 Host login</h1>
        </header>
        <form className="card" onSubmit={login}>
          <input
            className="input"
            type="password"
            autoFocus
            placeholder="Admin password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
          />
          {msg && <p className="error">{msg}</p>}
          <button className="btn" disabled={!pw}>
            Sign in
          </button>
        </form>
        <footer className="foot small">
          <a href="/">← Back to Song Swap</a>
        </footer>
      </main>
    );
  }

  return (
    <main className="wrap">
      <header className="head">
        <h1>🎧 Host controls</h1>
        <button
          className="link"
          onClick={async () => {
            await postJSON("/api/admin/login", { logout: true });
            setAdmin(false);
          }}
        >
          Sign out
        </button>
      </header>
      {flash && <p className={flash.ok ? "ok" : "error"}>{flash.text}</p>}

      <section className="card">
        <h2>Spotify</h2>
        {state?.connected ? (
          <>
            <p className="ok">Connected{state.spotifyName ? ` as ${state.spotifyName}` : ""}</p>
            {state.error && <p className="error">{state.error}</p>}
            <p className="muted small">
              Keep Spotify open and playing on a device (needs Premium). Guests&apos; songs are fed into your queue
              automatically near the end of each track.
            </p>
            <div className="row wrap-row">
              <button className="btn" onClick={() => act("resume")}>
                ▶ Play
              </button>
              <button className="btn" onClick={() => act("pause")}>
                ⏸ Pause
              </button>
              <button className="btn" onClick={() => act("skip")}>
                ⏭ Skip
              </button>
              <a className="btn ghost" href="/api/auth/login">
                Reconnect
              </a>
              <button className="btn ghost" onClick={() => act("disconnect", {}, "Disconnect Spotify?")}>
                Disconnect
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="muted">Not connected. Sign in with the Spotify account you want to play through.</p>
            <a className="btn" href="/api/auth/login">
              Connect Spotify
            </a>
          </>
        )}
      </section>

      <NowPlayingCard np={state?.nowPlaying ?? null} receivedAt={receivedAt} user={null} onChange={refresh} />

      <QueueList
        queue={state?.queue ?? []}
        userId={null}
        actions={(e) => (
          <div className="row">
            <button className="btn small-btn" onClick={() => act("playNow", { entryId: e.id })}>
              Play now
            </button>
            {!e.handedOff && (
              <button className="btn small-btn ghost" onClick={() => act("remove", { entryId: e.id })}>
                ✕
              </button>
            )}
          </div>
        )}
      />
      <History items={state?.history ?? []} userId={null} />

      <section className="card">
        <h2>Danger zone</h2>
        <button className="btn ghost" onClick={() => act("reset", {}, "Clear the queue, history and all ratings?")}>
          Reset session
        </button>
      </section>
      <footer className="foot small">
        <a href="/">← Guest view</a>
      </footer>
    </main>
  );
}

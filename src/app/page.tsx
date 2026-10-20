"use client";

import { useState } from "react";
import { Leaderboard, History, NowPlayingCard, QueueList, SearchAdd } from "@/components/parts";
import { useAppState, useUser } from "@/components/hooks";

export default function Home() {
  const { user, ready, setName } = useUser();
  const { state, receivedAt, loadError, refresh } = useAppState(ready ? (user?.id ?? null) : null);
  const [draft, setDraft] = useState("");

  if (!ready) return null;

  return (
    <main className="wrap">
      <header className="head">
        <h1>🎧 Song Swap</h1>
        {user && (
          <button
            className="link"
            onClick={() => {
              const n = prompt("Change your name", user.name);
              if (n && n.trim()) setName(n);
            }}
          >
            {user.name} ✎
          </button>
        )}
      </header>

      {!user ? (
        <section className="card">
          <h2>Who are you?</h2>
          <p className="muted small">Your name shows next to the songs you add and the ratings you give.</p>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim()) setName(draft);
            }}
          >
            <input
              className="input grow"
              autoFocus
              maxLength={24}
              placeholder="Your name"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button className="btn" disabled={!draft.trim()}>
              Join
            </button>
          </form>
        </section>
      ) : (
        <>
          {loadError && <p className="error">{loadError}</p>}
          {state && !state.connected && (
            <p className="banner">The host hasn&apos;t connected Spotify yet. Check back soon!</p>
          )}
          {state?.connected && state.error && <p className="banner">Waiting on the host&apos;s Spotify: {state.error}</p>}

          <NowPlayingCard np={state?.nowPlaying ?? null} receivedAt={receivedAt} user={user} onChange={refresh} />
          <SearchAdd
            user={user}
            hasQueued={state?.me.hasQueued ?? false}
            disabled={!state?.connected}
            onAdded={refresh}
          />
          <QueueList queue={state?.queue ?? []} userId={user.id} />
          <Leaderboard rows={state?.leaderboard ?? []} />
          <History items={state?.history ?? []} userId={user.id} />
        </>
      )}
      <footer className="foot muted small">
        <a href="/admin">Host login</a>
      </footer>
    </main>
  );
}

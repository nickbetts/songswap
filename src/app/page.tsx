"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { ArrowRight, ListPlus, Star, Trophy } from "lucide-react";
import { Dashboard, Logo, Themed } from "@/components/shell";
import { NameDialog } from "@/components/parts";
import { Art, Avatar, Equalizer } from "@/components/ui";
import { AppState, useAppState, useUser } from "@/components/hooks";

export default function Home() {
  const { user, ready, setName } = useUser();
  const { state, receivedAt, loadError, refresh } = useAppState(ready ? (user?.id ?? null) : null);
  const [editing, setEditing] = useState(false);

  if (!ready) return null;

  if (!user) return <Join state={state} onJoin={setName} />;

  return (
    <>
      <Dashboard
        user={user}
        state={state}
        receivedAt={receivedAt}
        loadError={loadError}
        refresh={refresh}
        onEditName={() => setEditing(true)}
        bottom={
          <footer className="foot">
            <a href="/admin">Host login</a>
          </footer>
        }
      />
      <NameDialog open={editing} initial={user.name} onSave={setName} onClose={() => setEditing(false)} />
    </>
  );
}

const STEPS = [
  { icon: ListPlus, title: "Request", text: "Search Spotify and add songs to the shared queue." },
  { icon: Star, title: "Rate", text: "Score everyone else’s picks out of 10 while they play." },
  { icon: Trophy, title: "Win", text: "Best average crowd score takes the crown." },
];

function Join({ state, onJoin }: { state: AppState | null; onJoin: (name: string) => void }) {
  const [draft, setDraft] = useState("");
  const np = state?.nowPlaying;

  return (
    <Themed image={np?.track.image ?? null}>
      <main className="join">
        <motion.div
          className="join-card glass"
          initial={{ opacity: 0, y: 30, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 140, damping: 20 }}
        >
          <Logo spinning />
          <h1 className="join-title">
            Your party.
            <br />
            <span className="gradient-text">Everyone’s playlist.</span>
          </h1>
          <p className="muted">Queue up songs, rate your friends’ picks, and crown the best taste in the room.</p>

          <ol className="steps">
            {STEPS.map((s, i) => (
              <motion.li
                key={s.title}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 + i * 0.08 }}
              >
                <span className="step-icon">
                  <s.icon size={18} />
                </span>
                <span>
                  <strong>{s.title}</strong>
                  <span className="muted small">{s.text}</span>
                </span>
              </motion.li>
            ))}
          </ol>

          <form
            className="join-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim()) onJoin(draft);
            }}
          >
            <label className="field">
              <span className="field-label">What should we call you?</span>
              <span className="field-row">
                <Avatar name={draft || "?"} size={36} />
                <input
                  className="input bare"
                  autoFocus
                  maxLength={24}
                  placeholder="Your name"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
              </span>
            </label>
            <motion.button className="btn btn-lg btn-cta" disabled={!draft.trim()} whileTap={{ scale: 0.97 }}>
              Join the party <ArrowRight size={20} />
            </motion.button>
          </form>

          {np && (
            <div className="peek">
              <Art src={np.track.image} size={40} />
              <div className="grow">
                <div className="eyebrow">
                  <Equalizer playing={np.isPlaying} /> Playing right now
                </div>
                <div className="title">
                  {np.track.name} <span className="muted">· {np.track.artists}</span>
                </div>
              </div>
            </div>
          )}
        </motion.div>
        <footer className="foot">
          <a href="/admin">Host login</a>
        </footer>
      </main>
    </Themed>
  );
}

"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, KeyRound, ListPlus, LogOut, Star, Trophy } from "lucide-react";
import { Dashboard, Logo, Themed } from "@/components/shell";
import { PasswordDialog, PasswordForm } from "@/components/parts";
import { Art, Avatar, Equalizer, Spinner } from "@/components/ui";
import { AppState, User, postJSON, useAppState, useSession } from "@/components/hooks";

export default function Home() {
  const { user, ready, setUser, logout } = useSession();
  const { state, receivedAt, loadError, refresh } = useAppState(ready);
  const [menu, setMenu] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);

  if (!ready) return null;

  if (!user) return <Join state={state} onJoin={(u) => (setUser(u), refresh())} />;

  if (user.mustChange) {
    return (
      <Themed image={state?.nowPlaying?.track.image ?? null}>
        <main className="join">
          <div className="join-card glass narrow">
            <Logo />
            <p className="muted">
              Hi <strong>{user.name}</strong>, welcome back!
            </p>
            <PasswordForm forced onDone={(u) => (setUser(u), refresh())} onCancel={logout} />
          </div>
        </main>
      </Themed>
    );
  }

  return (
    <>
      <Dashboard
        user={user}
        state={state}
        receivedAt={receivedAt}
        loadError={loadError}
        refresh={refresh}
        onEditName={() => setMenu(true)}
        top={
          (state?.me?.pending ?? user.pending) && (
            <section className="hostbar glass pending-note">
              <div className="grow">
                <div className="title">Waiting for the host to approve you</div>
                <div className="sub">
                  You can watch and listen now. Adding songs, rating and voting unlock once Nick approves your account.
                </div>
              </div>
            </section>
          )
        }
        bottom={
          <footer className="foot">
            <a href="/admin">Host login</a>
          </footer>
        }
      />
      <AnimatePresence>
        {menu && (
          <>
            <motion.div
              className="scrim"
              onClick={() => setMenu(false)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />
            <div className="dialog-wrap">
              <motion.div
                className="dialog glass"
                role="dialog"
                aria-modal
                initial={{ opacity: 0, scale: 0.92, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
              >
                <div className="row">
                  <Avatar name={user.name} size={44} />
                  <div className="grow">
                    <h3>{user.name}</h3>
                    <p className="muted small">Signed in</p>
                  </div>
                </div>
                <div className="account-menu">
                  <button className="btn ghost" onClick={() => (setMenu(false), setPwOpen(true))}>
                    <KeyRound size={16} /> Change password
                  </button>
                  <button className="btn ghost" onClick={() => (setMenu(false), logout())}>
                    <LogOut size={16} /> Log out
                  </button>
                </div>
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>
      <PasswordDialog open={pwOpen} onClose={() => setPwOpen(false)} />
    </>
  );
}

const STEPS = [
  { icon: ListPlus, title: "Request", text: "Search Spotify and add songs to the shared queue." },
  { icon: Star, title: "Rate", text: "Score everyone else’s picks out of 10 while they play." },
  { icon: Trophy, title: "Win", text: "Best average crowd score takes the crown." },
];

function Join({ state, onJoin }: { state: AppState | null; onJoin: (user: User) => void }) {
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

          <AuthForm onJoin={onJoin} />

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

function AuthForm({ onJoin }: { onJoin: (user: User) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const j = await postJSON("/api/user", { action: mode, username, password });
      onJoin(j.user);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="join-form" onSubmit={submit}>
      <div className="auth-tabs" role="tablist">
        {(["login", "register"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            className={mode === m ? "on" : ""}
            onClick={() => (setMode(m), setErr(null))}
          >
            {m === "login" ? "Log in" : "Sign up"}
          </button>
        ))}
      </div>
      <label className="field">
        <span className="field-label">Username</span>
        <span className="field-row">
          <Avatar name={username || "?"} size={36} />
          <input
            className="input bare"
            autoFocus
            autoComplete="username"
            maxLength={24}
            placeholder="Your name"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </span>
      </label>
      <label className="field">
        <span className="field-label">Password</span>
        <span className="field-row">
          <input
            className="input bare"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            placeholder={mode === "login" ? "Your password" : "At least 6 characters"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </span>
      </label>
      {mode === "login" && !err && (
        <p className="muted small">
          Requested songs before? Log in with your name and the temporary password <strong>i3media</strong>, then pick your own.
        </p>
      )}
      {err && <p className="error">{err}</p>}
      <motion.button className="btn btn-lg btn-cta" disabled={busy || !username.trim() || !password} whileTap={{ scale: 0.97 }}>
        {busy ? <Spinner size={20} /> : mode === "login" ? "Log in" : "Join the party"} {!busy && <ArrowRight size={20} />}
      </motion.button>
    </form>
  );
}

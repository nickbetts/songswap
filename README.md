# 🎧 Song Swap

Guests open your link, sign up with a username and password, add songs to a shared queue, and rate whatever is playing out of 10. Songs play through *your* Spotify account.

## How it works

- **Host** (`/admin`): sign in with `ADMIN_PASSWORD`, then click **Connect Spotify**. Controls: play/pause/skip, "play now", drag to reorder, shuffle or remove queued songs, delete played songs or individual scores from the history, reset the session. The host page also lets you add songs and vote as "Nick".
- **Guests** (`/`): search Spotify and add as many songs as you like. Rate other people's songs 1–10 (you can't rate your own); voting is open, and votes can be changed, until the song finishes.
- **Vote to skip**: anyone can vote to skip the current song (tap again to take it back). At 5 votes it skips straight to the next queued song; skipped songs are marked in the Played list.
- The app keeps its own queue and feeds the next song into Spotify's queue ~25s before the current one ends (or starts it if the player is idle). This runs whenever anyone has the page open, so keep the host page or a guest tab open during the session.
- Leaderboard ranks people by the average rating of their songs.

## Setup

1. **Spotify app**: create one at <https://developer.spotify.com/dashboard>. Add redirect URIs:
   - `https://YOUR-APP.vercel.app/api/auth/callback`
   - `http://127.0.0.1:3000/api/auth/callback` (local dev)

   While the app is in development mode, add your Spotify account under *User Management*. Playback control requires **Spotify Premium** on the host account.
2. **Vercel**:
   - Import the project, then add a **Neon** Postgres database from the Marketplace (Storage tab; free tier is fine). This sets `DATABASE_URL` automatically. A database is required so state is shared across serverless invocations; the app creates its own `kv` table on first use.
   - Set env vars: `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `ADMIN_PASSWORD`, `SESSION_SECRET` (see [.env.example](.env.example)).
   - Deploy.
3. Visit `/admin`, sign in, connect Spotify, and open Spotify on a device (start any song once so there's an active device). Share the main link.

## Local development

```bash
cp .env.example .env.local   # fill in values; DATABASE_URL optional (falls back to memory)
npm install
npm run dev -- -H 127.0.0.1
```

Open <http://127.0.0.1:3000>. (Spotify only allows `http` redirect URIs for loopback IPs.)

## Notes

- Guests have accounts (unique, case-insensitive usernames; scrypt-hashed passwords; signed httpOnly session cookie). The server derives who you are from the session, never from the request body. Failed logins are rate-limited.
- Anyone who requested songs before accounts existed gets an account under that name with the temporary password `i3media`, and must change it on first login.
- Spotify has no API to remove items from its queue, so a song is only sent to Spotify near the end of the previous track. Once sent, use Skip/Play now rather than Remove.

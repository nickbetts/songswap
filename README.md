# 🎧 Song Swap

Guests open your link, sign up with a username and password, add songs to a shared queue, and rate whatever is playing out of 10. Songs play through *your* Spotify account.

## How it works

- **Host** (`/admin`): only the host account (`HOST_USERNAME`, default "Nick") can get in. Log in as that user on the main page, then enter `ADMIN_PASSWORD` on `/admin` (8 wrong tries locks it for 15 minutes). The host cookie is tied to that login, lasts 12 hours, and stops working if you log out or change the account password. Then click **Connect Spotify** and pick the **playback device** (e.g. your laptop) so commands never land on another phone/computer signed into the same account. Controls: play/pause/skip, "play now", drag to change the turn order, shuffle or remove queued songs, delete played songs or individual scores from the history, reset the session. The host page also lets you add songs and vote as yourself.
- **Accounts & security**: new sign-ups wait for the host to approve them under **People** in `/admin` (the host can also block or delete accounts). Until approved they can watch but not add, rate or vote. Usernames are English letters/numbers only, and look-alikes of existing names (e.g. "N1ck", "Ni ck") are refused; the host name can't be registered. Login, password-change and admin-password attempts are limited atomically per account and per IP. Cookies are signed with `SESSION_SECRET` (required, never derived from `ADMIN_PASSWORD`), and the site can't be framed (clickjacking protection).
- **Guests** (`/`): search Spotify and add as many songs as you like. Rate other people's songs 1–10 (you can't rate your own); voting is open, and votes can be changed, until the song finishes.
- **Profile pictures**: open your account menu (your name/avatar in the header) to upload, replace or remove your own picture. JPG, PNG, WebP and animated GIF are supported, up to **5 MB**. GIFs retain their original animation; pictures appear in the player, queue, voters, scores, leaderboard and host People panel. Uploads are split into 1 MB authenticated chunks to support Vercel's request limits, then validated from their actual contents on the server. SVG/executable files and excessive image dimensions are refused. Pictures are public to the room; only the owning approved account can change them. Image data lives in the existing persistent KV store, not the account/password records.
- **Vote to skip**: anyone can vote to skip the current song (tap again to take it back). At 5 votes it skips straight to the next queued song; skipped songs are marked in the Played list.
- **Smart playlist**: Up Next is one continuous list, with no rounds or points. It plays in turns (e.g. Amy, Ben, Cal, Amy, Ben, Amy…), however many songs someone adds. Each person's own songs play in the order they added them, and whoever just played goes to the back of the rotation. Shuffle and host drag-reordering stay fair: they change who goes first and which of someone's songs plays next. Songs already sent to Spotify stay pinned; hosts can still remove them or use Play now on any queued song.
- The app keeps its own queue and feeds the next song into Spotify's queue ~25s before the current one ends (or starts it if the player is idle). This runs whenever anyone has the page open, so keep the host page or a guest tab open during the session.
- The **Leaderboard** ranks people by average song rating across the currently playing song and retained played history. The **Played** tab shows recent songs with their ratings, newest first. Existing requests, played songs and ratings are preserved when switching away from rounds; old round metadata no longer affects playback or rankings. The player keeps the larger 72px "Picked by" avatars.
- **Listening room**: album-colour lighting, a spinning record deck with a track-progress orbit, and a preview of the next pick. **Focus mode** hides the panels for an immersive player (Escape exits); requests and host controls still work. **Motion** pauses the decorative effects, and system reduced-motion preferences are respected. The ambient bars are decorative, not an audio analyser.
- **Floating Room FX controls**: every approved, signed-in user can use **Meeting mode**. It changes the shared room's Spotify volume, not their phone's volume: saves the selected device's current level, lowers it by 75% (to a quarter, rounded to Spotify's integer percentage), and restores it when anyone switches it off. Everyone sees the shared setting on the next poll. New/unapproved accounts cannot control it; other host actions remain host-only. Changes are rate-limited per account. The restore point survives page refreshes and repeated toggles don't compound the reduction. Turn it off before switching devices; disconnecting Spotify restores the volume first. Unsupported remote-volume devices show an error instead of guessing. If a command fails, the restore point stays available for a retry.
- **Default club room**: the original neon lighting, lazy-loaded Three.js mirror ball, portals, particles and perspective floor are now the everyday look. **Rave mode**, local to each viewer, switches to a front-row festival stage: a procedural LED wall, 96 laser rays, 12 sweeping beams, a deeper neon tunnel, speaker towers and a larger particle field. It also changes the headline, player layout, typography, card styling and queue layout. Escape exits Rave/Focus mode without touching playback. No strobing or audio analysis. **Motion off** and system reduced-motion stop the animation; hidden tabs stop rendering, resolution is capped for mobile, and devices without WebGL keep the CSS lighting with a notification.

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

- Spotify playback recognition accepts Spotify's relinked track IDs and alternative releases with the same verified recording code (ISRC), not just matching titles. Existing requests resolve their recording code once when needed. If Spotify accepts a song request but never confirms that track, automatic retries stop instead of repeatedly restarting it; the room displays a diagnostic warning and the host can retry with **Play now** after checking the device.
- Guests have accounts (unique, case-insensitive usernames; scrypt-hashed passwords; signed httpOnly session cookie). The server derives who you are from the session, never from the request body. Failed logins are rate-limited.
- Anyone who requested songs before accounts existed gets an account under that name with the temporary password `i3media`, and must change it on first login.
- Spotify has no API to remove items from its queue, so a song is only sent to Spotify near the end of the previous track. Hosts can still remove a **locked-in** request from the app after confirming a warning; this clears the request, not Spotify's queue, and does not skip playback. If it still plays in Spotify, use Skip/Play now.

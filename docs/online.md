# Online two-player mode

Two devices play one game over the internet. The existing single Railway service serves the static client and the WebSocket endpoint on the same port.

## Architecture

- `scripts/serve.mjs` (start command unchanged: `node scripts/serve.mjs`) serves the static files (with `noindex`) and loads `apps/server/dist/online.mjs`, which attaches a `ws` server to the same HTTP servers under path `/ws`. If that bundle is missing the static site still works and the log says "Online play disabled".
- `apps/server` bundles `src/index.ts` (esbuild, run by `pnpm build`) with `@dd/net` and `@dd/sim`; `ws` stays an external dependency.
- `packages/net` (`@dd/net`) holds everything that is testable without sockets:
  - `protocol.ts`: message types, strict validation (`parseClientMsg`), code alphabet.
  - `rooms.ts`: `RoomManager` (lobby, seats, ready, countdown, play, pause, reconnect, close, limits). It is driven by `message()`, `disconnect()` and `tick()` with an injectable clock, so tests run in virtual time.
  - `game.ts`: `ServerGame`, the authoritative 60 Hz run of `@dd/sim`, and snapshot packing.
  - `clientsync.ts`: `ClientSync`, prediction, reconciliation, clock sync and smoothing (used by the browser client and by the netsim).
  - `netsim.ts`: deterministic network simulator (latency, jitter, loss) used by the tests.
- Client: `apps/client/src/net/online.ts` (WebSocket, reconnect, ping), `ui/online.ts` (entry, lobby, QR, share, countdown, pause, result), `GameScene.startOnline()` (prediction loop instead of the local one).

## Flow

1. Main menu, **Play together**: **New game** (server makes a 6-character code from `23456789ABCDEFGHJKMNPQRSTUVWXYZ`, random, no 0/O/1/I/L) or **Join** (type the code, or open `/?room=CODE`, which goes straight to the lobby after the Start screen).
2. Lobby: code, QR code (client side, `qrcode-generator`), **Share via WhatsApp** (`https://wa.me/?text=...`), **Copy link**, **Share...** (Web Share API when present), choose Dum or Dee (a free seat), choose Analog/Digital for your own device, the host chooses **Continue** (campaign) or **Endless**; both press **Ready**, then a 3-2-1 countdown (server clock).
3. Play: each device controls only its own man (a touch anywhere is that man). Level end and game over are decided by the server and shown on both devices at the same time; stars and progress are saved locally on each device.
4. After the result both go back to the lobby (host can pick another level).

## Protocol (JSON text frames, max 4 KB)

Client to server: `create`, `join {room, token?}`, `seat`, `ctl`, `ready`, `level` (host), `in {seq, f:[{tick,push,h,jump}]}` (the last 5 frames, redundancy against loss), `ping {c}`, `leave`.

Server to client: `hello`, `joined {room, token, seat, host}`, `room {phase, level, seats, ...}`, `count {at}`, `start {level, at}`, `snap {tick, ms, inp, hi, st}` (20 Hz), `end`, `pause {until}`, `resume`, `pong {c, s}`, `closed {reason}`, `err {code}`.

## Synchronisation

- The server steps the shared sim at 60 Hz (`tickMs` = 16.67) and takes each seat's input from a per-tick buffer: the frame stamped with that tick, otherwise the last known input (hold). Late frames only update the hold value.
- Every 3rd tick a snapshot of the full `GameState` goes to both clients (obstacles far behind are dropped; scripted obstacles far ahead are restored from the client's own level data). Numbers are rounded to 1e-4.
- Clock sync: ping/pong every second; the sample with the lowest round trip gives the offset to the server clock. The client runs `lead = ceil((rtt/2 + 1.5 * jitter + 20 ms) / 16.67 ms)` ticks (2 to 30) ahead of the server so its inputs arrive before they are needed.
- Prediction: the client steps its own copy of the sim with its own input and the partner's last known input. On every snapshot it restarts from the server state and replays its own inputs for the ticks the server has not seen (reconciliation); nothing is stored per player beyond the input history.
- Smoothing: the difference between what was on screen and the corrected prediction becomes a correction offset that decays with a time constant of 120 ms for positions, hands, ladder angle and bucket. Only a very large error (more than 1.5 we in x, 0.6 rad ladder angle, ...) snaps.

## Connection loss

- Ping every second; the server pings every 8 s and drops a socket that was silent for 25 s. A closed socket pauses the room (`pause {until}`: 60 s) and the partner sees **Waiting for partner...**
- The client keeps `{room, token}` in `sessionStorage` and reconnects with back-off (0.3 s up to 3 s), immediately when the page becomes visible again (`visibilitychange`, `pageshow`, `online`), also after a screen lock or after the tab was reloaded. With the token the seat is taken back, the game resumes from the next snapshot.
- After 60 s the server closes the room (`closed: timeout`) and the other device shows "Game closed" with the reason.

## Safety

- Every message is parsed and range-checked; inputs are clamped again by the sim.
- Per socket token buckets (150 input/ping per second, 8 other messages per second); repeated violations close the socket (1008).
- Limits: 200 rooms, 600 sockets, 16 sockets per IP, 12 new rooms per minute per IP, rooms expire after 10 minutes without traffic, the Origin must match the Host.
- Codes and tokens come from `crypto.randomBytes`. No personal data is stored or sent; the only thing kept in the browser is the room code and token in `sessionStorage`.

## Testing

- `pnpm test`: `@dd/sim` plus `@dd/net` (protocol, rooms, limits, reconnect, netsim).
- Netsim results (20 s of scripted play, 30 ms jitter, 3% loss each way, error = prediction at tick k against the server state at tick k):

| round trip | mean x error (we) | max x error (we) | A vs B (both men, we) | lead (ticks) |
|---|---|---|---|---|
| 50 ms | 0.001 | 0.02 | 0.004 mean / 0.03 max | 4 |
| 100 ms | 0.004 | 0.04 | 0.014 mean / 0.06 max | 6 |
| 200 ms | 0.011 | 0.10 | 0.045 mean / 0.17 max | 9 |

  The scripted inputs change smoothly; abrupt changes of the partner's input cost roughly speed times (rtt + 50 ms) until the snapshot corrects it, which the smoothing hides.
- `pnpm build && pnpm test:e2e`: includes `e2e/online.spec.ts`, two browser contexts join one room (via `?room=`), ready, play, the second drops its socket and comes back, the first leaves and the second sees the closed message. The Playwright config starts `node scripts/serve.mjs` on port 4600 for these tests (`DD_SINGLE_PORT=1`).
- Manual: `pnpm build && PORT=3000 node scripts/serve.mjs`, open `http://localhost:3000` on two devices or two browser windows. `vite dev` proxies `/ws` to port 3000.

## Not tested

No real phones, no real mobile networks, no iOS Safari lock/unlock behaviour (only simulated by closing the socket), no load test beyond the unit-level limits, no TURN/NAT issues (not relevant: plain WebSocket over HTTPS), no Android back-button handling, no QR scan with a real camera (the QR comes from a library, rendered and visually checked).

Against production: `E2E_BASE=https://ddclient-production-47c1.up.railway.app npx playwright test e2e/online.spec.ts` (run once after the deploy of this feature: passed, two browser contexts over wss through the Railway proxy, states within 0.1 we).

# Identity, friends and invites

Built on top of the rooms above. Room codes and QR stay as the fallback (no account needed). Solo and one-screen play never need an identity: "Skip for now" at first start keeps everything anonymous.

## What a device and a player are

- First start: pick a name (2-16 characters, letters/digits/space and `. ' _ & -`, profanity filter EN+NL). The server returns a secret device token (48 hex characters). The browser keeps `{token, name}` in `localStorage` key `dd-id`; the server keeps only a SHA-256 hash of the token. Tokens are never logged.
- Friend code: `ROB-7K2` (3 letters from the name, then 3 random characters from `23456789ABCDEFGHJKMNPQRSTUVWXYZ`, no 0/O/1/I/L in the random part). Renewable ("Renew my code"). Typed codes accept any case, with or without dash.
- No personal data: no email, phone, location or analytics.
- "Delete me" (Friends, Settings): deletes the player, friendships, blocks, team names, invites and push subscriptions on the server and clears `dd-id` on the device. Accounts unused for 180 days are purged at start and daily.

## Friends

- Add by code sends a request; the other player must accept (mutual). Crossing requests auto-accept. There is no search by name and no friends-of-friends; a player only ever sees their own friends, requests and blocks.
- Friends list shows name, online/offline dot and the team name. Remove ends the friendship for both. Block removes the friendship, hides future requests from the blocked player (they get no error) and can be undone under "Blocked".
- Team name per pair: default `<A> & <B>`; one side proposes a name (max 24, same filter), the other must confirm, the old name stays until then. Stored per pair for a future leaderboard.

## Playing together

- "Play with <name>": the client opens a normal room, then sends `invite {id, room}` over the same socket. The server checks that the socket is in that lobby and that the two are friends.
  - Friend online (WebSocket): `invite` event and the banner "<name> is waiting - Join".
  - Friend offline: Web Push if they subscribed; otherwise the lobby shows a WhatsApp "nudge" button. Invites also appear in `me.invites` for 15 minutes, so the banner is there when the app opens (only while the room is still in the lobby).
- WhatsApp invite text: `Play Dum & Dee with me: <origin>/?invite=CODE — my code is CODE`.
- `?invite=CODE` landing: on iPhone Safari (not standalone, no identity in this browser) an explanation: "Add to Home Screen, open it, enter code CODE" with a link "I already have the app" -> "Open the app and enter code CODE" (iOS keeps separate storage for Safari and the home screen app, so the page cannot know which one the player has; both texts are offered). Elsewhere (Android/desktop/identity present) the code is prefilled in the first start ("Have an invite code?") or sent as a friend request.
- Push permission is asked only on a deliberate tap (Friends > Settings > Notifications). On iOS outside the home screen app, or where `PushManager` is missing, the screen explains why and points to the WhatsApp nudge.

## Wire (same `/ws`, JSON)

Client to server: `reg{name}`, `auth{token}`, `sync`, `rename`, `renew`, `delete_me`, `fr_add{code}`, `fr_yes/fr_no/fr_del/fr_block/fr_unblock{id}`, `team_set{id,name}`, `team_yes/team_no{id}`, `invite{id,room}`, `invite_dismiss{id}`, `push_sub{endpoint,p256dh,auth}`, `push_unsub{endpoint}`. Social messages are intercepted before the room manager, rate limited per socket (5/s, burst 15), and every id/code/endpoint is validated.
Server to client: `reg_ok{token}`, `cfg{vapid}`, `me{me}` (full own view, re-sent when anything relevant changes, including a friend going online/offline), `auth_fail`, `soc_err{code}`, `invite{id,from,name,room}`, `invite_sent{delivered: live|push|none}`, `push_ok`, `deleted`.
The app keeps one social socket for presence and invites; game sockets authenticate too (needed for `invite`).

## Data model (`packages/social/src/db.ts`, auto-migrated at start via `schema_version`)

| Table | Columns |
|---|---|
| `players` | `id`, `token_hash` (unique), `name`, `code` (unique), `blocked`, `created`, `last_seen` |
| `friendships` | `a`, `b` (a < b), `state` (pending/accepted), `requester`, `created`; PK (a, b) |
| `blocks` | `blocker`, `blocked` |
| `teams` | `a`, `b`, `name`, `pending_name`, `proposer`, `updated` |
| `invites` | `id`, `from_id`, `to_id`, `room` (the room link), `created`, `expires` |
| `push_subscriptions` | `id`, `player_id`, `endpoint` (unique), `p256dh`, `auth`, `created` |
| `settings` | `k` (PK), `v`; holds `vapid_public` / `vapid_private` when generated |

Rooms themselves stay in memory (they last minutes); the "rooms link" is `invites.room`, valid while the room is in its lobby. Schema is portable SQL (TEXT/BIGINT/INTEGER, `?` placeholders converted to `$n` for Postgres).

## Storage

- `DATABASE_URL` set: Postgres (`pg`, SSL unless the host is local or `*.railway.internal`).
- Otherwise a SQLite file via Node's built-in `node:sqlite` (Node 22.13+, pinned by `nixpacks.toml`): `./data/dd.sqlite`, override with `SQLITE_FILE` (`:memory:` for tests). The container disk on Railway is wiped on every deploy unless a volume is mounted at `/app/data`; use Postgres for anything you want to keep.
- If the store cannot open, the server logs it and keeps serving the game without social features.

## Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string (Railway Postgres plugin) |
| `SQLITE_FILE` | SQLite path when no `DATABASE_URL` (default `./data/dd.sqlite`) |
| `ADMIN_KEY` | Enables `/api/admin/*` (sent as header `x-admin-key`); unset = endpoints return 404 |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Optional override for the Web Push keys (invalid values are ignored with a log line and the generated keys are used). If not both set, the server generates a key pair on first start and keeps it in the database (table `settings`), so push works without manual keys |
| `VAPID_SUBJECT` | Optional contact for push services; default `mailto:admin@example.invalid` |

Note: the generated keys live in the database. With the SQLite fallback on Railway they vanish on every deploy (and every browser subscription with them), so push is only stable once Postgres is attached.

## Railway: exact steps

Only three things are required:

1. Project -> New -> Database -> Add PostgreSQL.
2. Web service (`ddclient`) -> Variables -> New Variable -> Add Reference: `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (use the plugin's name if it is not "Postgres").
3. Add `ADMIN_KEY` with a long random value (for example `openssl rand -hex 24`).

Redeploy. The log should show `Social: pg store, push on (keys from db), admin on`. Tables and push keys are created on first start.

Optional: set `VAPID_*` yourself (`pnpm vapid` prints a fresh set) if you want to control the keys. On iPhone, players need the home screen app for notifications (iOS 16.4+).

## Admin (basic)

All need header `x-admin-key: $ADMIN_KEY`; wrong keys are rate limited (10/min/IP).

```
GET    /api/admin/players?limit=100              list (no tokens)
POST   /api/admin/players/<id>/rename   {"name":"..."}   (filter applies)
POST   /api/admin/players/<id>/block                      (kicks live sockets, login refused)
POST   /api/admin/players/<id>/unblock
DELETE /api/admin/players/<id>                            (same wipe as "Delete me")
```

## Limits and safety

Friend-code lookups: 10 per minute per device and per IP. Registrations: 8 per hour per IP. Max 16 sockets per IP (existing). Names/team names validated and filtered on the server; messages are size-capped (4 KB, 600 B for social except push subscriptions).

## Tests

- Unit (`pnpm --filter @dd/social test`, 47 tests): codes, filter (incl. false-positive names), rate limiter, registration/token hashing, friendship flow (mutual accept, decline, crossing requests, remove, block/unblock, no friends-of-friends, rate limits), team-name confirmation, invites (friends only, expiry, dismiss), delete-me wipe, admin API over real HTTP, hub with fake sockets (live invite, push for offline, dead subscription cleanup, delete-me, room protocol unaffected), SQLite persistence across reopen, the same service on the Postgres adapter through `pg-mem`.
- E2E (`e2e/friends.spec.ts`): A creates identity, B enters the code, A accepts, team name proposed and confirmed, A "Play with B", B sees the banner and joins the room; also name filter, identity surviving a reload, skip, delete-me, `?invite=` on iPhone UA and desktop.

## Not tested

- Real Postgres (only `pg-mem`, an in-memory emulation of the SQL dialect); the SSL setting and Railway's reference variable are untested until the first deploy with `DATABASE_URL`.
- Web Push delivery to real devices (auto-generated keys are unit-tested on SQLite and pg-mem only) (iOS home screen app, Android Chrome, desktop): the service worker, subscription and the server send path with a fake sender are tested, the VAPID signing/`web-push` call against real push services is not. `pnpm vapid` was run (keys not kept).
- Real iPhone behaviour of the `?invite=` landing, "Add to Home Screen" and standalone detection (simulated by user agent only), real WhatsApp opening the link.
- Admin endpoints against production.

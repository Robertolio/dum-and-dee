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

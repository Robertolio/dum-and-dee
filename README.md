# Dum & Dee

Cooperative web game: window cleaners **Dum** (blue, back) and **Dee** (red, front) carry one long ladder with a bucket of water through a factory hall. Keep the same pace, tilt the ladder on purpose to duck under hanging lamps, catch the automatic step-ups with your knees, and above all: move calmly. Sloshing costs water, a tilted ladder does not.

This repository is at **phase 1**: a playable one-screen prototype (one phone, two thumbs — or two players on one keyboard) built to prove the feel of ladder, balance, bucket and step-ups before any network code is written.

## Stack

- TypeScript (strict), pnpm workspaces
- `packages/sim` — pure, deterministic 60 Hz simulation (no DOM, no Phaser). Tested with Vitest.
- `apps/client` — Vite + Phaser 3 renderer, touch/keyboard input, HUD, debug panel. Smoke-tested with Playwright.

## Getting started

Requirements: Node 22+, pnpm 10+.

```bash
pnpm install
pnpm dev          # Vite dev server on http://localhost:5173 (also reachable on your LAN via --host)
```

Open the URL on a phone in **landscape** (same Wi-Fi) or on a laptop.

### Controls

**Touch (one phone, two thumbs)** — left half is Dum, right half is Dee.

| Posture mode | Thumb | Effect |
|---|---|---|
| Analog (default) | hold | upright; drag down → bend to a deep squat, drag up → stretch; release → upright |
| Digital | hold | upright; release → bent |
| both | drag right / left | run / brake. Push keeps its last value when you lift the thumb, so one thumb can both walk and bend. |

**Keyboard (two players on one keyboard)**

| | Dum | Dee |
|---|---|---|
| bend / stretch | `S` / `W` | `↓` / `↑` |
| walk / brake | `D` / `A` | `→` / `←` |
| run (with walk) or crouch (alone) | left `Shift` | right `Shift` |

`F` toggles real fullscreen on desktop (also in the debug panel). `R` resets the run.

### Debug panel

The gear button (bottom right) opens the panel: switch **Analog / Digital** posture, **Touch / Keyboard** input, fullscreen, reset, a replay recorder (record inputs → replay them with other tuning values) and live tuning sliders (arm reach, posture speed, ladder spring, bucket damping, water sensitivity, lamp swing…) plus readouts (ladder angle, balance, suspension-point acceleration, pendulum angle, water loss rate).

All start values live in one file: `packages/sim/src/tuning.ts`.

## Scripts

```bash
pnpm test         # Vitest: simulation (ladder angle, arm reach, water only lost through shocks, lamp, step-ups, determinism)
pnpm test:e2e     # Playwright smoke test on an 844×390 touch viewport (uses the installed Chrome; set PW_CHANNEL= to use Playwright's Chromium)
pnpm typecheck    # tsc for all packages
pnpm build        # production build of the client
```

## Deploy on Railway

Static site, tester-only (`noindex` via meta tag, `X-Robots-Tag` header and `robots.txt`). Config lives in `railway.json`; `scripts/serve.mjs` serves `apps/client/dist` on `$PORT`.

1. railway.com → **New Project** → **Deploy from GitHub repo** → `Robertolio/dum-and-dee` (branch `main`).
2. Check **Settings**: Root Directory empty (repo root), Build Command `pnpm install --frozen-lockfile && pnpm build`, Start Command `node scripts/serve.mjs` (both come from `railway.json`). No variables are needed; Railway sets `PORT`.
3. **Settings → Networking → Generate Domain** to get `https://<name>.up.railway.app` (HTTPS is automatic).
4. Every push to `main` redeploys automatically.

Local check: `pnpm install && pnpm build && PORT=4321 pnpm start`.

## Project layout

```
packages/sim/src     tuning.ts, state.ts, input.ts, step.ts, ladder.ts, bucket.ts, lamp.ts, stepup.ts, collision.ts, level.ts
packages/sim/test    Vitest specs
apps/client/src      main.ts, scenes/GameScene.ts, input/ (touch + keyboard), render/ (figures, ladder, HUD, thumbs), debug/ (panel, replay), platform/ (fullscreen)
apps/client/public/art   flat SVG placeholders (wall, pipes, floor, crate, bracket, pallet, lamp cap, bucket)
apps/client/e2e      Playwright smoke test
docs/                tuning log
```

## Status

See `docs/tuning-log.md` for what was tried and the open tuning questions for milestone M1 (analog vs digital feel, arm reach).

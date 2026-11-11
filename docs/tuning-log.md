# Tuning log

Measured with the headless simulation (`packages/sim`), 60 Hz, default tuning (`packages/sim/src/tuning.ts`). "Water lost" is in percent of a full bucket.

## Phase 1 baseline (prototype build)

| Situation | Peak aP,y (we/s²) | Water lost | Note |
|---|---|---|---|
| Hold a 12° tilt for 5 s | 0 | 0 % | Tilt is free, as intended |
| One player bends alone (0.8 → 0.2) | ~15 | ~1.3 % | Unavoidable at phase 2 of a lamp |
| Both switch simultaneously | ~3.5 | 0 % | Suspension point stays still |
| Switch one after the other (0.3 s apart) | ~18 | ~2.7 % | Clear penalty, ~2× a single bend |
| Start walking (push 0.6) | 0 (horizontal) | ~1.3 % | Pendulum swings to ~20°; see question 3 |
| Hard brake (push −0.3) | — | ~2.2 % | Pendulum swings ~50° |
| Walk under a lamp upright | — | 8 % + 2 ticks × 4 % | Lamp swings, cap rides on the ladder, ticks 1–3 times |
| Step onto a crate without bending | ~11 | ~0.9 % | `stepMissed` |
| Step onto a crate, bending along perfectly | ~8.6 | ~0.5 % | `stepCaught` +50 |
| Same, reacting 3 ticks (50 ms) late with some anticipation | ~9.8 | ~0.6 % | still caught |
| Same, reacting 5 ticks (83 ms) late without anticipation | ~11 | ~1.8 % | caught by the ±50 % rule but *more* water than not reacting |

## Deviations from the plan's start values

- `hTargetRate` (new, 4 /s): the posture target is rate-limited before the critically damped spring (τ 0.12 / 0.10 s). Without it a digital tap produced a single-tick acceleration spike of ~100+ we/s² and infinite jerk.
- `stepRate` (new, 6 we/s) and `tStep` 0.25 → 0.22: the step-up target is rate-limited as well (the foot lifts gradually), then follows a critically damped spring with ω = 3 / tStep.
- `accelFilter` (new, 0.05 s): suspension-point acceleration is low-pass filtered before it drives water loss.
- `jSafe` 25 → 150, `kJ` 0.05 → 0.01, and jerk is **vertical only**. Horizontal shocks already show up as pendulum swing (φ term), so counting them twice made every walk start expensive; the vertical jerk of a calm bend already peaks at ~380, so the term now only bites on real stutter.
- `sMax` 0.5 → 0.15 and `wV` 0.25 → 0.5 applied to the **push difference** instead of the actual speed difference. The ladder spring equalises the actual speeds within a few ticks and the steady-state tension is capped at `aMax / k ≈ 0.13 we`, so the plan's values made the balance meter almost immobile. Now: 1.0 vs 0.6 push → orange (≈ 0.45), one running while the other brakes → red and the ladder slips after 0.6 s.
- `catchTolerance` (new, 0.5): a step counts as caught when the hand moved less than half the step height, as the plan asked ("±40 %, generous"), instead of a strict acceleration threshold.
- Lamp contact distinguishes a **knock** (approach speed > 0.6 we/s, or first contact) from **resting contact** (the cap rides on the ladder and is pushed out of it without a splash). Without this the cap ticked every 0.15 s for the whole 3 s the ladder was below it.
- Ladder spring sign: the plan's "A gets +F, B gets −F" with `F = −k·s − c·ṡ` is unstable for `s = (xB − xA) − L0`; implemented as `F = k·s + c·ṡ` on A (pull A forward when B is ahead).

## Open questions for M1

1. **Analog vs digital.** Analog gives the precision for catching step-ups and half postures; digital is simpler and always within arm reach. Both are in the debug panel. In analog mode releasing the thumb springs back to upright; in digital mode release = bent. Which neutral feels right on a real thumb? The measured feel so far: digital costs no extra water as long as the two players switch together; analog only pays off at step-ups and at the (later) low lamp.
2. **Arm reach `ΔyMax` = 1.3 we (generous).** Only deep squat vs full stretch (1.5 we) exceeds it, and then the balance meter moves only to ≈ 0.2. With a pallet (+0.6) it reaches ≈ 0.8 (red, no fail). Tighten to ~1.1 so the limit is felt during normal analog play, or keep it as a soft edge?
3. **Walk start cost (~1.3 %).** `aMax = 8` makes every start swing the bucket past 15°. Lower `aMax` for acceleration (heavier feel) or raise `phiSafe` to ~20°?
4. **Step-ups: shock vs catchability.** With the hand spring (τ 0.10 s + rate 4 /s) the knees cannot absorb a step that is faster than the posture itself; a late reaction even adds a second shock. Current values make a missed crate cost ~0.9 % and a well-timed catch ~0.5 % (plus +50 score). Options for M1: slower steps (`stepRate` 3–4, `tStep` 0.3) so a human can follow, or a faster downward posture (`hFall` 0.06) at the price of harsher bends elsewhere.
5. **Touch push latch.** On one phone a player has one thumb, so push keeps its last value after release (tap once = walk, drag left and release = stop). Is that acceptable for the two-phone version, or should push require holding the thumb as in the plan?

## Playtest round 2

- `ladderOverhang` 0.6 → 1.2 we (ladder 6.6 we); lamp test windows widened accordingly.
- Level is now endless (`ENDLESS_LEVEL`, seeded generator in `level.ts`, difficulty rises over ~340 we); obstacles behind the ladder are pruned.
- New: hanging meat (`meat*` tuning, swings on its own, same collision as lamps), floor props (banana, duck, pail, tyre, cheese), stairs (treads of 0.2 we, walked automatically; risers below 0.25 we do not score).
- Walk cycle is driven by distance travelled (`walk.ts`), so feet do not slide; legs rest when standing.

## Playtest round 3

- Floor props block: rises above `autoStepMax` (0.22 we) must be jumped (stair treads, 0.2 we, still auto-step). Jump = `PlayerInput.jump` (Space / Enter, thumb flick up or tap on touch); sin² arc of `jumpHeight` 0.9 we over `jumpTime` 0.7 s, the hands follow 30 %.
- Props slide a little when pushed (mass-based, `pushFriction`), the pair stops via the ladder coupling. Banana: slip unless feet are above 0.12 we under the peel (slow, splash, ladder jolt).
- Stairs 3–5 risers with a ceiling beam above the plateau (`yBottom` = top + 1.5 we): upright ladder bonks, water loss and rebound.
- Fix: water in the bucket was an unrotated rectangle; it is now drawn in the bucket frame with a level surface.

## Audio

All sound is WebAudio synthesis (`apps/client/src/audio/sfx.ts`), no assets. The AudioContext is created/resumed on the first tap or key (start button); Phaser's own audio is disabled. Sound and music toggles (bottom right) are stored in `localStorage` key `dd-audio`; master gain 0.6 into a compressor, SFX bus 0.5, music bus 0.07.

## iOS audio unlock

Unlock happens on touchend / pointerup / click / keydown (capture phase), not on touchstart. It sets `navigator.audioSession.type = 'playback'`, loops a silent `<audio>` element, plays a silent buffer and calls `resume()`; it also resumes on visibilitychange / pageshow / focus. A "Tap for sound" pill shows while the context is not running.

## Speech balloons and water sound

- `render/speech.ts`: comic balloons with mouth animation and per-man "mumble" blips; urgent lines (Ouch!, Whoa!, Oh no!) interrupt, hints (Duck!, Jump!, Watch out!, Careful!) and cheers (Nice!) are rate limited.
- Splash is now randomised noise wash + bandpass sweep + low "gloop" glides; a continuous brown-noise slosh follows the bucket swing (`setSlosh`).
- Analog control shows no on-screen markers any more.

## Round 4 tweaks

- Ladder overhang 1.2 → 1.52 we (one rung spacing, 0.32 we, more at each end); ladder length 7.24 we.
- Water audio is now cartoon-like: sine "bloop" bubbles with rising pitch, drip plinks, short high-passed sploosh; the continuous slosh is a very quiet airy hiss with sparse gurgles.
- Lamp light cone and glow rotate with the lamp's swing (axis follows the cord direction).

## Round: bucket clamp, water z-order, balloons/webs, broken lamps, art

- Bucket is lifted with the ladder over obstacles/stairs and never sinks below the floor (liftUp 8, liftDown 2); stair beams raised to rise*n+1.75.
- Bucket art is translucent with water drawn behind the rim (no blue block).
- Balloons (+30) and cobwebs (+15) in the endless generator; no water cost.
- Lamps break when the knock impulse exceeds lampBreakImpulse 2.6 (-12 water, no life); darkness with flashlight glow until the next intact lamp within 4.5 we.
- Art: meat (marbling, bone, hook), curvier banana with stem, clearer tyre. Banana slip window left at core +-0.3 (jump test passes).

## Round: bucket knocks
- Auto-lift over props removed (only floor/stairs lift); bucket touching a prop = bucketBonk (ladder shock, swing, -3 water, bonk).
- Cleaver (knife, 0.3 high) under ~55% of hanging meat; banana thicker; bone sticks out higher.

## Round: cleaver tuning + app icon
- Knife 0.26 high, 0.9 wide, placed 1.3 we before meat (landing room), 22% double knife 1.5 we apart. Icon + manifest added.

## Round: icon v2, knives, variety
- Icons regenerated via canvas (opaque, full-bleed), file names -v2 for cache busting.
- Knives end 3.4 we before the first meat of a series (no knives under swinging pieces); optional second knife 1.7 further back.
- Generator: 13 pattern kinds, weighted, no immediate repeat, quiet stretches and busy combos via gapScale.

## Round: score/levels/studio
- Combo x1.5/2/3 at 3/6/10 clean passes (props passed without bump, lamps, balloons, webs); +25 per clean prop pass; extra life every 2000 (max 5); checkpoints every 60 we on a clear spot, respawn with a fresh bucket; level-end bonuses (water x5, lives x500, time) and 1-3 stars.
- Levels: tutorial + 5 factory levels (60-120 s) from fixed pattern lists; Endless Factory; TV Studio s1-s3 and Endless Studio (new props, boom mics, wheel/fan/weather set pieces).

## Round: phone finish
- Wake Lock on play, iOS Add-to-Home-Screen tip (dismissible, remembered), notch safe-area insets for HUD, animated rotate notice, particle caps (maxAliveParticles) and adaptive quality (fps<48 for 3 s: half particles, no light cones/cameramen; <25% at level 2; recovers after 12 s above 58 fps). No texture atlas yet (SVGs rasterised per sprite at load).

## Round: one campaign, two-button menu, richer TV studio
- Campaign = f0..f5 then s1..s5 (`CAMPAIGN`, `nextLevel`); level end offers "Next", labelled "(TV Studio)" at the factory-to-studio border; a gate with a TV STUDIO label stands at the end of f5; s1 opens with the banner "Now entering: TV Studio".
- Main menu: Play (Continue + level name once progress exists; resumes at first unfinished level) and Endless; small "Levels" link for the level list. One Endless: `mixed` generator, theme alternates every MIXED_ZONE = 260 we (factory, studio, ...), a gate, flash and banner at each border; backdrop, lamp caps, decor follow the zone. `ENDLESS_LEVEL` (factory only) stays for sim tests.
- New studio floor props: clapper (0.3), director's chair (0.6), popcorn cart (0.7, heavy), dummy doll (0.55), soundboard (0.45); cable (0.1, slip like a banana); red carpet (walk it: +40 glam).
- New soft set pieces (ladder passes through): ON AIR sign +60, APPLAUSE sign +80, buzzer +100, break-away set wall +50 but -5 water (falls over). Tuning: scoreOnAir/Applause/Buzzer/Wall/Carpet.
- Generator kinds 16-21 (studio only): commercial break (fast: 4 props/cable/buzzer/ON AIR at 3.1-3.5 we spacing, banner "COMMERCIAL BREAK!"), red carpet + applause, wall + buzzer, soundboard + applause high up, clapper + ON AIR + cable, dummy/cable/dummy. Studio weights rebalanced (fewer web/balloon/quiet, more props).
- Levels s2/s3 reworked with the new patterns; s4 "Live broadcast" and s5 "Season finale" added (difficulty 0.7-1.0).
- Studio extras: scrolling news ticker on the floor band, teleprompter next to the news set.
- Newsreader: original bearded man in a dark suit with tie, flat style, replaces the generic presenter in news-desk.svg (no portrait of a real person).

## Round: online two-player (phase 3)
- See `docs/online.md`. Server-authoritative 60 Hz sim, 20 Hz snapshots, client prediction with a lead of `ceil((rtt/2 + 1.5 jitter + 20 ms)/16.7 ms)` ticks, own inputs replayed after each snapshot, correction offsets decay with tau 120 ms.
- Room codes: 6 characters from a 31-letter alphabet, reconnect grace 60 s, rooms idle out after 10 min, per socket rate limits.
- `scripts/serve.mjs` loads `apps/server/dist/online.mjs` (built by `pnpm build`) and attaches `/ws` to the same HTTP servers; `DD_SINGLE_PORT=1` disables the extra safety-net ports (used by e2e).

## Round: identity, friends, invites (phase 4)
- New package `packages/social` (identity, friends, teams, invites, push, admin, SQLite/Postgres store), wired into the same `/ws` and `/api/admin/*`; client: Friends screen, first-start name prompt (skippable), invite banner, `sw.js` for push, `public/privacy.html`. Details, env vars and Railway steps in `docs/online.md`.

## Round: simplified intro and play-together (phase 5)
- Principle: zero choices before the first moment of play, explanation only during play. Start screen removed, two-button home, coach-marks in level 1, automatic controls per device, lobby/room code/QR removed from the UI. See `docs/online.md`.

## Round: boathouse (level b1)
- New theme `boathouse` (last in the campaign, after the TV studio; button in ☰ and in Levels, `?level=b1`, also online since the server only needs the level id). The ladder is drawn as a skiff (white hull, blue stripe with a thin yellow line), the bucket is gone: `bucket.water` is the hull integrity (HUD shows a hull bar, result says Hull). Swinging no longer costs anything (`lossRate` 0); every knock still does (slip, beam, wall, bonk, lamp), so the same tuning applies. Hull 0 = a life lost = skiff wrecked, back to the checkpoint with a new skiff; 0 lives = game over, exactly as before.
- Damage is visual only and deterministic from the hull value: scratches from 4% damage, cracks from 22%, holes from 41%, missing chunks from 62%.
- Props (new step kinds): ergometer, roller trestle, worn slide seat (the jump-over before hanging oars), life vest, coxswain cushion, boat trailer, sponge, rope, hose, puddle. Rope, hose and puddle trip or slip like cables and bananas (`isTripKind`). Hanging oars (`oar`, swing like the meat), hanging vests and pennants (sweepable, same score as webs), stairs with a beam as in the factory. Level `b1` is a composed pattern list with rising difficulty (0.2 to 0.8).
- Club colours (RV Naarden, from its house rules and tenue page): cornflower blue RAL 5015, gold yellow RAL 1003, chalk white RAL 9003; oar blades are white with a blue/yellow/blue band. Used here as #2a6ebb, #f2a900, #f4f4ee.
- Sounds (WebAudio, procedural): `hullCrack` (replaces the splash sound in the boathouse), `hullBreak` (hull gone), `waterIn` (end).
- End: from 9 we before the end the floor runs down into the water; reaching the end splashes, then the result screen after 2.4 s.
- Not tuned: balance of b1 (length, hull damage per knock) and its online feel.

## Round: riggers and the rowing race (levels b1 riggers, r1)
- Riggers: the skiff (`drawSkiff` in `render/ladder.ts`, used in the boathouse and the rowing race) has a bracket with a dol (ring) and a dolpen at both seats (hull positions 0.36 and 0.66), on the visible side; a fainter pair shows the far side. In the rowing race the oars run through these dols.
- New theme `rowing`, level `r1` "Rowing race" (last in `CAMPAIGN`; ☰ button, Levels button `btn-rowing`, `?level=r1`). No ladder or bucket: `GameState.row` (null elsewhere) holds the skiff x/v, roll, jump, the two rowers (stroke position `a` 0..1, blade `lift` 0..1), synchrony, ducks, buoys, bridges. `packages/sim/src/rowing.ts` has the constants (`ROW`), kept out of `Tuning`.
- Control design (same `PlayerInput`, so online and replay work unchanged): the horizontal axis IS the stroke. `push` -0.3..1 maps to stroke position 0..1 (catch to finish). Touch: drag the thumb left, then right, like pulling an oar (full swing = 240 px). Keyboard: hold D (Dum) or Right (Dee) = pull, release = recover. The vertical axis (posture) is the blade height: upright = in the water, down = lifted. Touch analog: drag down about 40 px and hold. Touch digital: let go of the screen = hover. Keyboard: W/S (Dum) or Up/Down (Dee) set a persistent oar height (no spring back in this level), 1.5 per second. Jump = existing flick, tap, Space or Enter (either rower jumps the whole skiff).
- Physics: blade drives only when it is in the water (`lift < 0.2`) and the stroke position increases; thrust `ROW.thrust` (1.1) times stroke speed times a bell factor `0.6 + 0.8 sin(pi a)` times synchrony `q = 0.3 + 0.7 sync`. Synchrony = 1 - |a0 - a1| / 0.55, smoothed with tau 0.25 s. Drag `0.35 v + 0.06 v|v|`. Roll is driven by the difference in drive of the two sides; |roll| > 0.3 slows the boat. Stroke gap above 0.8 = oars clash (speed x0.6, -3 hull, 0.9 s cooldown). Cruise: about 3.1 we/s at one stroke per second, 4.2 at 1.5 per second (HUD shows m/s = we x 1.35).
- Obstacles: duck (jump: hit zone is |dx| < 0.6 while the hull is lower than 0.2; hit = speed x0.5, -8 hull; passed = +50), buoy (pops from `popSpeed` 2.3 we/s = +100, otherwise it bounces the boat back with a recoil and -3 hull; every failed try lowers the needed speed by 0.4, so it can never soft-lock), bridges (`low` ceiling 0.74, `wood` 0.82, `arch` 0.72 rising to 1.0 in the middle, `stone` 0.92; oars in the water or above the ceiling = -8 hull, speed x0.5, 1.2 s cooldown; a clean pass = +150).
- Start and finish: the shot is fired 2.5 s after the start (`gunTick`); the starter raises the pistol from 1.5 s before, a red START flag pops out of the barrel, the race time starts at the shot. The finish line is at `length - 2`; the man with the stopwatch shows the time and the result screen says `Time m:ss.t`. Time bonus uses the race time (par 100 s).
- The cyclist on the towpath is client-only decoration: he rides by every 8 to 13 s when something is coming (duck, bridge, buoy, low sync, low speed), shouts it through the megaphone (speech balloon plus `sfx.megaphone`).
- Sounds (WebAudio, procedural): `gunshot`, `buoyBang`, `horn` (finish), `quack`, `oarDip` (blade enters the water), `oarClash`, `megaphone`; splash and bonk are reused.
- Coach-marks: `row` (stroke), `lift` (bridge ahead), `duck` (duck ahead), shown once each when the situation arises (`Coach.updateRow`).
- Not tuned: balance (course length 300 we, spacing, ceilings, thrust and pop speed), keyboard feel, touch swipe feel on a real phone, online feel.

## Rowing easier (LD-19) and campaign by environment (LD-20)

- Bridge glide: drag x0.25 from 3 we before a bridge to its end (`ROW.glide`, `ROW.glideBefore`). A bot test enters every bridge at 3 we/s with no rowing and must pass.
- Bridges shortened (low 5, wood 6, arch 8, stone 9). Duck zone 0.6 -> 0.45, clear height 0.2 -> 0.12, jump 0.85 s.
- Bridge and duck warnings come from the cyclist 22-25 we ahead, ignoring the cooldown; cyclist spawns closer and faster; 'Faster! Bridge ahead!' when slow; the oar-lift coach mark repeats for the first two bridges.
- Campaign: f0, s1, b1, r1, f3, s3, b2, r2, f5, s5, b3, r3 (ids unchanged, so dd-progress needs no migration). f1, f2, f4, s2, s4 are extra levels in the Levels list. r2/r3 are generated courses with clearance rules checked by tests.
- Online: the server owns the level. Either player may switch (last wins); a switch during play restarts for both; completing a level advances the room to the next one.
- Boathouse end sign: Asyntis logo from `apps/client/public/art/asyntis.png` (text fallback until the file exists). Rowing has no end gate.

## Leaderboard

- Plausibility limits (`plausible` in `packages/social/src/leaderboard.ts`): 800 points per second plus 3000, 9 we/s maximum average speed. They are generous on purpose; they only stop absurd values. Tighten them once real runs show the normal range.
- Cache 15 s and 60 reads per minute per IP for the read API.
- Revised the plausibility limits to be per environment (400 points per second, Endless 300, plus 3000, max 9 we/s average) and shared by the Solo list and the online lists. Solo submissions: 6 per minute per player, 20 per minute per IP.

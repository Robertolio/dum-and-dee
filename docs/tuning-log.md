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

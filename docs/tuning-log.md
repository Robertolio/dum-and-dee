# Tuning log

Measured with the headless simulation (`packages/sim`), 60 Hz, default tuning. Values in `%` are water lost.

## Phase 1 baseline (prototype build)

| Situation | Peak aP,y (we/s²) | Water lost | Note |
|---|---|---|---|
| Hold a 12° tilt for 5 s | 0 | 0 % | Tilt is free, as intended |
| One player bends alone (0.8 → 0.2) | ~15 | ~2 % | Unavoidable at phase 2 of a lamp |
| Both switch simultaneously | ~3.5 | ~0 % | Suspension point stays still |
| Switch one after the other (0.3 s apart) | ~18 | ~4 % | Clear penalty |
| Start walking (push 0.6) | 0 (horizontal) | ~1.3 % | Pendulum swings to ~20°; see question 3 |
| Hard brake (push −0.3) | — | ~2.2 % | Pendulum swings ~50° |
| Walk under a lamp upright | — | 8 % + 2 ticks × 4 % | Lamp swings, cap rides on the ladder, ticks 1–3 times |
| Step onto a crate without bending | ~6.5 | ~1 % | `stepMissed` event |
| Step onto a crate while bending along | < 6 | 0 % | `stepCaught` +50 |

## Deviations from the plan's start values

- `hTargetRate` (new, 4 /s): the posture target is rate-limited before the critically damped spring (τ 0.12 / 0.10 s). Without it a digital tap produced a single-tick acceleration spike of ~100+ we/s² and infinite jerk.
- `accelFilter` (new, 0.05 s): suspension-point acceleration is low-pass filtered before it drives water loss.
- `jSafe` 25 → 60, `kJ` 0.05 → 0.03, and jerk is **vertical only**. Horizontal shocks already show up as pendulum swing (φ term), so counting them twice made every walk start expensive.
- `sMax` 0.5 → 0.15 and `wV` 0.25 → 0.5 applied to the **push difference** instead of the actual speed difference. The ladder spring equalises the actual speeds within a few ticks and the steady-state tension is capped at `aMax / k ≈ 0.13 we`, so the plan's values made the balance meter almost immobile. Now: 1.0 vs 0.6 push → orange (≈ 0.45), one running while the other brakes → red and the ladder slips after 0.6 s.
- Lamp contact distinguishes a **knock** (approach speed > 0.6 we/s, or first contact) from **resting contact** (the cap rides on the ladder and is pushed out of it without a splash). Without this the cap ticked every 0.15 s for the whole 3 s the ladder was below it.

## Open questions for M1

1. **Analog vs digital.** Analog gives the precision for catching step-ups and half postures; digital is simpler and always within arm reach. Both are in the debug panel. In analog mode releasing the thumb springs back to upright; in digital mode release = bent. Which neutral feels right on a real thumb?
2. **Arm reach `ΔyMax` = 1.3 we (generous).** Only deep squat vs full stretch (1.5 we) exceeds it, and then the balance meter moves only to ≈ 0.2. With a pallet (+0.6) it reaches ≈ 0.8 (red, no fail). Tighten to ~1.1 so the limit is felt during normal analog play, or keep it as a soft edge?
3. **Walk start cost (~1.3 %).** `aMax = 8` makes every start swing the bucket past 15°. Lower `aMax` for acceleration (heavier feel) or raise `phiSafe` to ~20°?
4. **Touch push latch.** On one phone a player has one thumb, so push keeps its last value after release (tap once = walk). Is that acceptable for the two-phone version, or should push require holding the thumb?

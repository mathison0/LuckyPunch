# PikaPlanner v4 changelog

v4 is the current baseline.

## Inherited correctness/stability fixes
- Net-front early-contact defense: predicts an opponent who is already airborne before the ball fully crosses.
- Impossible defensive threats are graded by miss distance instead of one flat penalty.
- Ground-frame contacts are not counted as saves.
- Sample-and-hold receive timing corrected.
- Court-bound reachability corrected near the net.
- Touch inference compares against world-only ball physics instead of treating gravity-driven velocity change as a contact.
- 5-touch risk and AIR_CLEAR safety added for long possessions.
- Long deterministic rallies get a tiny safe pre-position nudge after 900 rally frames.

## Tournament-rule review cleanup
- Removed unused legacy tuning constants that could confuse match-day edits.
- `snapshot.config.tickFrameGroupSize` is used consistently where scheduler cadence matters.
- Added exact round-reset freeze detection. Repeated frozen snapshots no longer look like player contacts to the touch estimator.
- During the frozen inter-round state, jump/hit are suppressed while horizontal pre-positioning is retained. This prevents stale jump/dive input from firing on the first live frame.
- Added `tools/frozen_round_regression.mjs`.

## Skill adapter cleanup
Live hooks:
- `read`
- `ballFrameHook`
- `reachOverride`
- `extraOpponentThreats`
- `extraActions`
- `evaluate`
- `emergencyOverride`
- `decorateAction`

Do not use `decorateAction` speculatively. The current rules still require `{x,y,hit}`; only change the return contract if the updated match-day API explicitly says so.

## Offline harness correction
The old local harness randomized the server again after every point. The published tournament rule says the opening serve is random, not every rally. `tools/sim_engine.mjs` now:
- randomizes only the opening serve,
- follows original-game subsequent serve flow (the side that conceded receives the next serve),
- includes a tournament-mode runner for 10 points / 4-minute lead / 5-minute golden ball,
- models the known frozen round-transition ticks for regression.

The previous harness is retained as `tools/sim_engine_legacy_random_serve.mjs` for reproducibility. Old scorelines remain useful as regression clues, not tournament-faithful predictions.

## Current verification
- JS syntax: pass.
- 900-call contract/benchmark: pass, average about 3.2 ms in this container.
- Cushion regression: pass.
- Mirror sanity: 1000/1000 paired safe snapshots mirrored correctly.
- Frozen-round regression: 52/52 reset snapshots returned valid horizontal-only actions with `y=0, hit=0`.
- Corrected tournament harness, seed 1 examples (regression only):
  - tuned v1: v4 won from both sides.
  - v05: v4 won from both sides.
  - v07: v4 won from both sides.
  - v2.1: v4 led from both sides at regulation timeout in the checked seed.
  - v2 remains a deliberately difficult stress opponent; one checked RIGHT orientation lost 0-2 at regulation after the freeze-model correction. This is a strategic stress case, not a correctness failure.

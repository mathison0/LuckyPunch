# PikaPlanner v2.1 Stability Diagnostic

## Scope
Minimal correction of v2. Core trajectory scoring, power-hit search, cushion handling, opponent reachability, and tactical hierarchy are intentionally preserved.

## Independent findings from replay logs
1. Ground receive planning scored an arbitrary future ideal contact but did not reject an earlier player-ball overlap. The engine always resolves the first overlap, so actual outgoing vx / net interaction could differ completely from the planner's evaluation. This produced repeated local `CLEAR` touches and touch-limit losses.
2. Canonicalization was not exact at the net center x=216. The disclosed engine uses `x < 216 ? -abs(vx) : +abs(vx)`. Mirroring RIGHT into LEFT requires flipping the equality branch. Without that, RIGHT-side power shots that really rebound to self-side could be scored internally as opponent-side winners.
3. Some near-net down-smash losses were only 1–4 px outside the hitbox one frame before ground. This suggests a defensive safety-margin issue, but it is not patched yet because the first-contact receive fix already removed much of the observed instability and a broader defense patch showed regression risk.
4. Opponent 1 intentionally randomizes defensive standby motion, while opponent 2 adapts defense/contact/serve tempo during the match. Some score streak variance is therefore opponent-induced, not a v2 bug.

## v2.1 candidate changes
- Keep v2 scoring/design intact.
- Fix canonical net-center tie for RIGHT mirroring.
- Ground receive candidates are now evaluated at the FIRST actual overlap along the held-action path, not a later idealized contact.
- Preserve existing self-set, attack, defense, cushion, and power-hit evaluation otherwise.
- Add a conservative one-intent-per-possession self-set gate based on planned contact ETA, without using raw gravity-driven `vy changed` as a safety-critical touch counter.

## Small regression sample (simulator, equal latency=1, first-to-5)
Against opponent code 1:
- v2 and v2.1 both remained strong in the sampled seeds.
- v2 produced touch-limit losses in sampled sets; v2.1 candidate produced none in the checked latency=1 seeds.

Against opponent code 2, exact comparison seed set:
- LEFT seeds 100, 8019, 15938: base v2 1/3 wins; v2.1 candidate 3/3 wins, scores 5-0, 5-0, 5-2.
- RIGHT seeds 500, 8419, 16338: base v2 1/3 wins; v2.1 candidate 3/3 wins, scores 5-1, 5-0, 5-4.
- v2.1 candidate touch-limit losses in those six sets: 0.

## Important limitation
At simulated latency=2 the touch-limit pathology can reappear because the bot is tuned around the measured fast-JS latency=1 execution phase. Venue Chrome tests remain authoritative.

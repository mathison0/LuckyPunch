# Tournament rules - what they mean for v4

## 1. First to 10, but the clock can end the set early
- Normal target is 10 points.
- At 4:00, the team currently ahead wins immediately.
- If tied at 4:00, golden ball continues until the next point or 5:00.
- If still tied at 5:00, the set is a draw.

**Practical effect:** a 30-40 second deterministic rally is not harmless. It consumes a meaningful fraction of a four-minute set. v4's long-rally loop breaker is therefore worth keeping. Do not add speculative clock-gaming logic unless the released repository exposes an authoritative timer field or confirms that `tick` matches the official set clock.

## 2. Preliminary round is six single-set matches
A single bad self-kill, 5-touch loss, or one-sided bug matters more than in a long series. Robustness is more valuable than a narrow tactic that only wins a particular seed.

Third-place teams are also compared using standings / point differential, so free points matter. Winning is first priority, but 10-2 is more useful than 10-9 when tie-breaks matter.

## 3. Final bracket is best-of-three sets
Variance matters a little less than in preliminaries, but a stable base is still preferable. Do not enter the bracket with an unverified skill patch merely because one test set looked strong.

## 4. Opening serve is random
Test both LEFT and RIGHT and more than one seed. A side swap with the same seed is not automatically an exact mirror experiment because P1/P2 and opening-server identity can change.

The offline tournament harness in this package now randomizes only the opening serve. After a point it follows the original game's rally flow (the side that conceded receives the next serve). The released tournament repository remains authoritative.

## 5. Five contacts on one side loses the point
This is a hard safety rule. A skill that causes extra local contacts, a failed self-set, or a dash that clips the ball twice can be catastrophic even if the tactic looks clever.

During skill-day tests, count these separately:
- intentional self-set,
- ordinary body return that stays local,
- skill contact,
- repeated overlap / multi-contact edge cases.

## 6. One file, JavaScript, < 4 MB
Current v4 is about 60 KB and uses no import/require. There is enormous size headroom. Do not spend time micro-optimizing file size.

## 7. Time budget
- decision target: 120 ms
- hard timeout: 360 ms
- 15 consecutive hard timeouts restart the worker
- organizer Q&A says ordinary bots usually return in about 3 ms on the match PC

Current v4 verification in this container is roughly 3 ms average. Keep skill simulation bounded; an ideal final candidate should still stay comfortably below 20-30 ms in local profiling.

## 8. Opponent field is probably not uniformly elite
This is an inter-university event and the theme is unfamiliar to many teams. That makes reliability even more valuable:
- do not overfit to v05/v07/v2-style sophisticated opponents,
- do not assume every opponent models your position,
- a correct receive + strong ordinary attack + one useful skill rule may beat a complicated but brittle skill planner.

Use our advanced reference bots mainly as stress tests, not as a prediction of the whole field.

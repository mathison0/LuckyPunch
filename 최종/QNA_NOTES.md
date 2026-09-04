# Competition Q&A - practical implications for v4

1. Existing snapshot fields remain and several fields are added.
   - v4 is a valid fallback even if the skill patch fails.
   - `SKILL.read()` must tolerate missing fields.

2. Hidden rule is gone; only a skill is added.
   - Do not spend the one-hour window guessing unrelated physics changes.
   - Still inspect exactly where the skill code enters the frame-update order.

3. New repository + localhost access + one hour before the first match.
   - The released source is stronger evidence than every pre-event hypothesis.
   - Spend the first 10-15 minutes reading before coding.

4. A competent skill-using bot will be provided.
   - Treat it as executable documentation.
   - Extract activation fields, gauge conditions, state restrictions, and intended usage.

5. Skill is theoretically defendable.
   - Implementing only our skill use is incomplete.
   - If the skill changes reach/contact timing, opponent reach and threat prediction must change too.

6. 120 ms decision budget; ordinary return around 3 ms.
   - v4 currently averages about 3 ms in our harness.
   - Avoid brute-force skill search with hundreds of trajectories until profiling proves it safe.

7. Reproducible odd collision behavior is part of the game.
   - Do not expect a referee correction for a repeatable head/ball pass-through.
   - Reproduce and code around it.

8. LLM questions: team total 3, 300 chars each.
   - Inspect source first.
   - Use questions on ambiguity that remains after source reading: activation contract, exact frame order, or a specific failing code path.

9. Tournament rules add a four-minute set clock.
   - Long deterministic rallies are strategically expensive.
   - v4's long-rally loop breaker should stay enabled unless testing proves it harmful.

10. Preliminary stage is single-set and point differential can matter.
   - Avoid high-variance tricks and own-goals.
   - A safe baseline plus a simple correct skill use is a strong default for a field that may not be uniformly advanced.

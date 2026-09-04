# 60-minute match-day checklist

## 00:00-00:05 - Freeze the baseline
- [ ] Copy `PikaPlanner_v4.js` to `PikaPlanner_v4_BASE.js`; never edit BASE.
- [ ] Run BASE in the new repository.
- [ ] Confirm one set starts, both sides move, and ignoring the skill does not crash.
- [ ] Confirm the updated API still accepts ordinary `{x,y,hit}`.

## 00:05-00:15 - Read, do not code yet
- [ ] Find all new snapshot fields.
- [ ] Find gauge / cooldown / ready state.
- [ ] Find exact skill activation input or return field.
- [ ] Find the exact frame-update order.
- [ ] Read the provided skill-using bot.
- [ ] Fill `SKILL_FACTS_WORKSHEET.md`.
- [ ] Spend an LLM question only if source semantics remain ambiguous.

## 00:15-00:25 - Micro-test one skill use
- [ ] Make a tiny bot that activates the skill exactly once.
- [ ] Measure gauge threshold, cost, reset, cooldown.
- [ ] Measure movement / ball effect frame by frame.
- [ ] Check whether collision occurs during a dash path or only at destination.
- [ ] Check LEFT and RIGHT once.
- [ ] Check whether opponent skill state is visible.

## 00:25-00:35 - Patch defense/correctness first
1. `SKILL.read()` - normalize new fields.
2. If action API changes, `SKILL.decorateAction()` - make one valid activation work.
3. Ball effect -> `ballFrameHook()`.
4. Mobility / hitbox / jump reach -> `reachOverride()`.
5. New opponent attack trajectory -> `extraOpponentThreats()`.

## 00:35-00:45 - Add our useful skill use
6. `extraActions()` - add the smallest useful skill candidate set.
7. `evaluate()` - compare skill use against the ordinary v4 plan.
8. `emergencyOverride()` only for a narrow, proven rescue case.

## 00:45-00:53 - A/B test
- [ ] Provided skill bot: both sides.
- [ ] Provided skillless AI: sanity control.
- [ ] v05 / v07: net-front defense regression.
- [ ] v2 / v2.1 / tuned v1: long-rally regression.
- [ ] first-to-10 / four-minute tournament-mode check.
- [ ] at least two seeds for the candidate if time permits.
- [ ] record failure types, not just win/loss.

## 00:53-00:57 - Tune only what the logs justify
- [ ] Change one parameter at a time.
- [ ] Keep a before/after result and failure count.
- [ ] Prefer fixing repeated self-kill / 5-touch / skill-miss failures over chasing one lucky score.
- [ ] If a change breaks ordinary no-skill play, revert.

## 00:57-01:00 - Freeze and submit
- [ ] `node tools/verify_v4.mjs <candidate.js>`
- [ ] `node tools/mirror_sanity.mjs <candidate.js>`
- [ ] `node tools/frozen_round_regression.mjs <candidate.js>`
- [ ] confirm skill can fire at least once.
- [ ] confirm gauge=0 / skill unavailable still works.
- [ ] final file is one `.js`, under 4 MB, no import/require.
- [ ] save separately as the submission candidate; no architecture changes now.

## Revert rule
If skill integration is still unstable around minute 50, submit clean v4 rather than a broken skill bot. The organizer explicitly says old snapshot behavior remains valid and a bot that ignores added skill fields still plays normally.

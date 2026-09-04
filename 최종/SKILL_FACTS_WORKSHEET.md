# Skill facts worksheet - fill before coding

Do not guess. Read the released repository and the provided skill-using bot first.

## 1. Snapshot
- New field names:
- Self gauge field / range:
- Opponent gauge field / range:
- Cooldown / ready field:
- Skill state field while active:
- Gauge reset on point / set / match?:
- Any timer-related field added?:

## 2. Activation contract
- Does `decide()` still return only `{x,y,hit}`?:
- If not, exact new return field(s):
- Allowed states: ground / jump / power / dive / recovery:
- Can skill activate without touching the ball?:
- Can x/y/hit be combined with skill in the same decision?:
- Gauge consumed on request, activation, success, or contact?:

## 3. Exact frame order
Write the source-code order, not an interpretation.
1.
2.
3.
4.
5.
6.

Answer explicitly:
- ball world physics before/after skill movement?:
- ordinary player movement before/after skill movement?:
- player-ball collision before/after skill movement?:
- ground/score check before/after player collision?:
- skill state update before/after collision?:

## 4. If mobility skill (dash / teleport / super-jump)
- distance / velocity:
- duration frames:
- direction choice:
- can change direction while active?:
- destination clamped to court?:
- can cross net?:
- collision along path or destination only?:
- hitbox changes?:
- usable in air?:
- usable during state 2 power arm?:
- recovery / lockout after use?:

## 5. If ball-changing skill
- vx change:
- vy change:
- gravity / acceleration:
- curve:
- wall/net collision changes:
- power-hit interaction:
- does effect persist after one frame?:

## 6. Gauge economics
- gauge gain condition:
- exact cost:
- max gauge:
- cooldown:
- point-end reset?:
- can both players hold ready skill simultaneously?:
- common number of uses per rally in provided bot?:

## 7. Minimum micro-tests
- [ ] threshold-1 gauge: no activation
- [ ] threshold gauge: activation
- [ ] one ground use
- [ ] one air use if allowed
- [ ] one near-net use
- [ ] LEFT / RIGHT mirror
- [ ] opponent skill use observed
- [ ] skill + ball collision observed
- [ ] skill + net/wall interaction observed if relevant
- [ ] skill unavailable: old v4 behavior still normal

# (궤적 예측 + 스매시 결과 역산 봇)에
# 발톱 스킬(발동·회피)만 얹은 버전. 스킬 로직은 파일 하단 finalize에 모아뒀다.

GW = 432
HALF = 216
BR = 20
GY = 252
PY = 244
PHL = 32
# 공 중심의 이동 범위. 양쪽 벽 모두 공 중심이 화면 끝에 닿을 때 반사한다 —
# 왼쪽을 BR(20)로 쓰면 엔진과 어긋난다.
BOUNCE_MIN_X = 0
BOUNCE_MAX_X = GW
NET_TOP = 176
NET_BOT = 192
NET_HW = 25

# --- 스킬 상수 (skills.md 참고) ---
CLAW_COST = 55
CLAW_WIDTH = 60
CLAW_WARN = 25                          # 발톱 예고 프레임
CLAW_DANGER = CLAW_WIDTH // 2 + PHL     # = 62. |self.x - centerX|가 이하면 위험
DODGE_MIN_FRAMES = 7                    # 남은 프레임이 이 이하면 이미 늦음


# 점프 아크: ARC[t] = 점프 t프레임 후 플레이어 y (yVelocity=-16, 중력 +1)
def _make_arc():
    a = [PY]
    y = PY
    yv = -16
    for _ in range(1, 40):
        y += yv
        if y < PY:
            yv += 1
            a.append(y)
        else:
            a.append(PY)
            break
    return a


ARC = _make_arc()
AIR = len(ARC) - 1


# 엔진의 월드 스텝을 그대로 재현한 궤적 시뮬레이터
def sim_traj(x, y, xv, yv, max_f):
    out = []
    for _ in range(1, max_f + 1):
        if x + xv < BOUNCE_MIN_X or x + xv > BOUNCE_MAX_X:
            xv = -xv
        if y + yv < 0:
            yv = 1
        if abs(x - HALF) < NET_HW and y > NET_TOP:
            if y <= NET_BOT:
                if yv > 0:
                    yv = -yv
            else:
                xv = -abs(xv) if x < HALF else abs(xv)
        fy = y + yv
        if fy > GY:
            out.append({'x': x, 'y': GY, 'yv': -yv, 'ground': True})
            return out
        y = fy
        x = x + xv
        yv += 1
        out.append({'x': x, 'y': y, 'yv': yv, 'ground': False})
    return out


def landing(x, y, xv, yv):
    t = sim_traj(x, y, xv, yv, 250)
    l = t[-1]
    return {'x': l['x'], 'frames': len(t), 'ground': l['ground']}


# 파워히트 결과: xVel = ±(|xd|+1)*10, yVel = |byv| * yd * 2
def smash_out(bx, by, byv, xd, yd):
    nxv = (abs(xd) + 1) * 10 if bx < HALF else -(abs(xd) + 1) * 10
    return landing(bx, by, nxv, abs(byv) * yd * 2)


# 몸통 접촉 결과: xVel = (오프셋/3)|0, yVel = -max(|byv|,15)
def bump_out(bx, by, byv, off):
    if off > 0:
        xv = abs(off) // 3
    elif off < 0:
        xv = -(abs(off) // 3)
    else:
        xv = 0
    a = abs(byv)
    return landing(bx, by, xv, -(15 if a < 15 else a))


prev_y = PY
prev_tick = -99
prev_opp_x = HALF


# 스킬 마무리 — 결정된 (x, y, hit)에 회피 오버라이드와 skillX를 얹는다.
# 회피가 필요하면 x를 좌우 도피 방향으로 덮어쓴다 (스매시 조준 등이
# 깨지지만, 기절 1.8초를 맞는 것보다 낫다).
# 발동 가능하면 상대의 8틱(약 24프레임) 뒤 예측 위치를 노려서 쏜다.
def finalize(x, y, hit, s):
    global prev_opp_x
    c = s['opp']['claw']
    if c is not None and c['framesUntilStrike'] >= DODGE_MIN_FRAMES:
        offset = s['self']['x'] - c['centerX']
        if abs(offset) <= CLAW_DANGER:
            if offset == 0:
                x = -1 if s['side'] == 'LEFT' else 1
            else:
                x = 1 if offset > 0 else -1

    skill_x = None
    if (s['self']['gauge'] >= CLAW_COST
            and s['self']['claw'] is None
            and s['self']['state'] < 4):
        vx = s['opp']['x'] - prev_opp_x           # 틱당 이동량
        target = s['opp']['x'] + vx * 8           # 예고 25프레임 ≈ 8틱
        if target < 0:
            target = 0
        if target > GW:
            target = GW
        skill_x = target

    prev_opp_x = s['opp']['x']

    if skill_x is not None:
        return {'x': x, 'y': y, 'hit': hit, 'skillX': skill_x}
    return {'x': x, 'y': y, 'hit': hit}


def decide(s):
    global prev_y, prev_tick, prev_opp_x
    try:
        if s['tick'] - prev_tick > 30:
            prev_y = PY
            prev_opp_x = s['opp']['x']
        prev_tick = s['tick']

        is_r = s['side'] == 'RIGHT'
        sgn = -1 if is_r else 1
        my_min = HALF + PHL if is_r else PHL
        my_max = GW - PHL if is_r else HALF - PHL
        opp_min = BR if is_r else HALF
        opp_max = HALF if is_r else GW
        me = s['self']
        ball = s['ball']
        opp = s['opp']

        def mine(xx):
            return xx >= HALF if is_r else xx <= HALF

        def cl(xx):
            return max(my_min, min(my_max, xx))

        traj = sim_traj(ball['x'], ball['y'], ball['xVelocity'], ball['yVelocity'], 90)
        end = traj[-1]

        # 현재 체공 시간 역산 (전역 prev_y로 상승/하강 판별)
        air_t = -1
        if me['state'] == 1 or me['state'] == 2:
            rising = me['y'] < prev_y
            bd = 1e9
            for t in range(1, AIR + 1):
                if (ARC[t] < ARC[t - 1]) != rising:
                    continue
                d = abs(ARC[t] - me['y'])
                if d < bd:
                    bd = d
                    air_t = t
            if air_t < 0:
                air_t = 1
        prev_y = me['y']

        def score_land(r, k):
            if not r['ground']:
                return -1e9
            if not mine(r['x']):
                if r['x'] < opp_min + 24 or r['x'] > opp_max - 24:
                    return -1e9
                return 1000 + abs(r['x'] - opp['x']) * 2 - k * 0.5
            if r['frames'] < 22:
                return -1e9
            return 300 + r['frames'] * 5 - k * 0.5

        best = {'sc': -1e18, 'val': None}

        def consider(sc, a):
            if sc > -1e8 and sc > best['sc']:
                a['sc'] = sc
                best['sc'] = sc
                best['val'] = a

        for k in range(1, len(traj) + 1):
            b = traj[k - 1]
            if b['ground']:
                break
            if not mine(b['x']):
                continue
            px = cl(b['x'])
            if abs(px - b['x']) > PHL:
                continue
            gap = abs(px - me['x'])

            # --- 공중 파워히트 ---
            if gap <= 6 * k + 10:
                def try_t(tt, jd, _b=b, _k=k, _px=px):
                    if tt < 1 or tt > AIR or abs(_b['y'] - ARC[tt]) > 31:
                        return
                    for xi in range(2):
                        for yd in range(-1, 2):
                            xd = xi
                            r = smash_out(_b['x'], _b['y'], _b['yv'], xd, yd)
                            sc = score_land(r, _k)
                            if sc <= -1e8:
                                continue
                            safe = True                     # ±1프레임 오차 내성
                            for o in (-1, 1):
                                idx = _k - 1 + o
                                if idx < 0 or idx >= len(traj):
                                    continue
                                bb = traj[idx]
                                if bb['ground']:
                                    continue
                                rr = smash_out(bb['x'], bb['y'], bb['yv'], xd, yd)
                                if not rr['ground'] or mine(rr['x']):
                                    safe = False
                                    break
                            if not safe:
                                continue
                            consider(sc + 150, {'mode': 1, 'k': _k, 'jd': jd,
                                                'xd': xd, 'yd': yd, 'tx': _px})

                if air_t > 0:
                    try_t(air_t + k, 0)
                else:
                    for j in range(0, 31):
                        try_t(k - j, j)

            # --- 지상 몸통 접촉 / 다이빙 ---
            if (air_t < 0 and me['state'] != 3 and me['state'] != 4
                    and abs(b['y'] - PY) <= 31):
                for off in range(-30, 31, 6):
                    tx = cl(b['x'] - off)
                    if abs(b['x'] - tx) > PHL:
                        continue
                    g = abs(tx - me['x'])
                    dive = g > 6 * k + 10
                    if dive and g > 8 * k + 10:
                        continue
                    rb = bump_out(b['x'], b['y'], b['yv'], b['x'] - tx)
                    consider(score_land(rb, k) - (400 if dive else 0),
                             {'mode': 2 if dive else 3, 'k': k, 'tx': tx})

        x = 0
        y = 0
        hit = 0

        if best['val'] is not None:
            bv = best['val']
            dx = bv['tx'] - me['x']
            if abs(dx) > 5:
                x = 1 if dx > 0 else -1
            if bv['mode'] == 1:
                if me['state'] == 0 and bv['jd'] <= 1:
                    y = -1
                elif (me['state'] == 1 or me['state'] == 2) and bv['k'] <= 6:
                    hit = 1
                    y = bv['yd']
                    if bv['xd'] == 0:
                        x = 0
                    elif x == 0:
                        x = sgn
            elif bv['mode'] == 2 and me['state'] == 0:
                if x == 0:
                    x = 1 if dx > 0 else -1
                hit = 1
            return finalize(x, y, hit, s)

        # 접촉 불가: 낙하지점 추격, 최후에 다이빙
        if mine(end['x']):
            dx = cl(end['x'] - sgn * 22) - me['x']
            if abs(dx) > 5:
                x = 1 if dx > 0 else -1
            if me['state'] == 0 and abs(dx) > 6 * len(traj) and abs(dx) > 40:
                hit = 1
                if x == 0:
                    x = 1 if dx > 0 else -1
            return finalize(x, 0, hit, s)

        # 상대 코트로 갈 공: 대기 위치로
        dx = cl(HALF + 125 if is_r else GW - HALF - 125) - me['x']
        if abs(dx) > 5:
            x = 1 if dx > 0 else -1
        return finalize(x, 0, 0, s)
    except Exception:
        return {'x': 0, 'y': 0, 'hit': 0}    # 어떤 예외에도 무입력으로 안전 종료

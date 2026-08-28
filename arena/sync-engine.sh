#!/usr/bin/env bash
# 대회 저장소의 물리 엔진을 ESM 사본으로 복사한다.
# 엔진이 갱신되면(당일 스킬 추가 등) 이 스크립트를 다시 돌릴 것.
set -e
SRC="$(dirname "$0")/../src/resources/js"
DST="$(dirname "$0")"
cp "$SRC/rand.js" "$DST/rand.mjs"
sed "s|from './rand.js'|from './rand.mjs'|" "$SRC/physics.js" > "$DST/physics.mjs"
echo "동기화 완료: physics.mjs, rand.mjs"

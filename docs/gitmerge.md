예를 들어 현재 레포가 `LuckyPunch`이고, 가져올 레포가 `OtherRepo`라고 하면 현재 레포 폴더에서:

```bash
git remote add other https://github.com/USER/OtherRepo.git
git fetch other
git branch -a
```

가져올 레포의 기본 브랜치가 `main`이라면:

```bash
git merge other/main --allow-unrelated-histories
```

두 레포가 서로 별개로 만들어진 저장소라면 보통 `--allow-unrelated-histories`가 필요합니다.

충돌이 나면 충돌 파일을 수정한 뒤:

```bash
git add .
git commit
```

완료 후 임시 remote가 필요 없으면:

```bash
git remote remove other
```

그리고 현재 GitHub 레포로 올리면 됩니다.

```bash
git push origin main
```

### 만약 "기존 레포를 유지하면서 다른 레포 코드로 사실상 덮어쓰고 싶다"면

이 경우에는 merge보다 **다른 레포 파일만 가져오는 방식**이 더 깔끔할 수도 있습니다.

```bash
git remote add other https://github.com/USER/OtherRepo.git
git fetch other
git checkout other/main -- .
```

그 다음:

```bash
git add .
git commit -m "Import code from OtherRepo"
git push origin main
```


-------------------------------------------------------------
-------------------------------------------------------------



보통 fork 저장소에서 **원본 저장소의 `main`을 내 브랜치에 합치는 것**이면 이렇게 하시면 됩니다.

```bash
git remote -v
```

먼저 `upstream`이 등록돼 있는지 확인합니다.

없으면:

```bash
git remote add upstream <원본 저장소 URL>
```

그다음 최신 내용을 가져옵니다.

```bash
git fetch upstream
```

현재 작업 브랜치가 `main`이라면:

```bash
git switch main
git merge upstream/main
```

충돌이 없으면 끝입니다.

내 GitHub의 `origin/main`에도 반영하려면:

```bash
git push origin main
```

즉 전체 흐름은:

```bash
git fetch upstream
git switch main
git merge upstream/main
git push origin main
```

입니다.

만약 지금 작업 중인 별도 브랜치, 예를 들어 `skill-test`에 upstream main을 합치려면:

```bash
git fetch upstream
git switch skill-test
git merge upstream/main
```

하시면 됩니다.

충돌이 나면 Git이 충돌 파일을 알려줍니다. 파일 안의

```text
<<<<<<< HEAD
내 코드
=======
upstream 코드
>>>>>>> upstream/main
```

부분을 직접 정리한 뒤:

```bash
git add .
git commit
```

하면 merge가 완료됩니다.

그리고 **로컬 변경사항이 아직 commit 안 된 상태라면 먼저 commit하거나 stash**하는 게 안전합니다.

```bash
git status
```

변경사항이 있으면:

```bash
git stash
git fetch upstream
git merge upstream/main
git stash pop
```

처럼 진행할 수 있습니다.

지금 상황이 `mathison0/LuckyPunch`가 fork이고 대회 운영진 저장소가 upstream이라면, 원하시면 제가 **현재 remote 구조 기준으로 정확한 명령어**도 적어드릴 수 있습니다.
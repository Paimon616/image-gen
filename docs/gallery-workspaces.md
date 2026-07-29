# 갤러리 워크스페이스 (Gallery Workspaces)

갤러리 이미지를 워크스페이스로 묶어 관리하는 기능입니다. 이 문서는 **새 컴퓨터에서
클론했을 때**와 **기존 사용자가 `git pull` 받을 때** 충돌 없이 바로 적용하는
방법을 정리합니다.

## 기능 요약

- 갤러리 상단 바에서 워크스페이스를 선택하면 **해당 워크스페이스 이미지만** 표시됩니다.
- **전체 보기**를 선택하면 워크스페이스와 무관하게 모든 이미지를 봅니다.
- 워크스페이스를 선택한 채로 이미지를 생성하면 **자동으로 그 워크스페이스에 등록**됩니다.
- 이미지 카드(hover) 또는 상세 뷰어의 폴더 아이콘에서 이미지를 **여러 워크스페이스에
  지정/해제**할 수 있습니다. (미지정 이미지 지정, 다중 등록, 등록 해제 모두 가능)

## 저장 방식 (중요: 충돌이 나지 않는 이유)

- 워크스페이스 목록과 "어떤 이미지가 어떤 워크스페이스에 속하는지"는 **단일 파일**
  `data/workspaces.json` 에 저장됩니다.
- 이 파일은 **`.gitignore`에 등록**되어 있습니다 (`output/`, `uploads/`,
  `data/history/` 와 동일한 런타임 데이터 취급). 따라서:
  - **git으로 추적되지 않으므로 `pull` 시 이 파일 때문에 충돌이 나지 않습니다.**
  - 컴퓨터마다 로컬 이미지(`output/`, gitignore)가 다르므로 워크스페이스 배정도
    컴퓨터별 로컬 상태로 유지됩니다. 다른 컴퓨터로 자동 동기화되지 않습니다.
- **기존 이미지의 사이드카 메타데이터(`output/<id>.json`)는 전혀 수정하지 않습니다.**
  워크스페이스 소속 정보는 위 중앙 파일에만 기록됩니다. → **마이그레이션이 필요 없습니다.**
- `data/workspaces.json`이 없으면 첫 실행/첫 API 호출 시 빈 상태로 **자동 생성**됩니다.
  수동 생성이 필요 없습니다.

---

## A. 새 컴퓨터에서 클론 후 세팅

워크스페이스 기능만을 위한 추가 설정은 **없습니다.** 평소 프로젝트 세팅을 그대로 따르면 됩니다.

```bash
git clone <repo-url>
cd image-gen

npm install
npm run setup:git-merge          # (Windows: npm run setup:git-merge:win) 아래 C절 참고

# 백엔드 설치 (필요한 것만) — 자세한 내용은 docs/image-backends-setup.md
npm run setup:comfyui            # (Windows: npm run setup:comfyui:win)

npm run dev
```

실행 후 갤러리 상단의 **전체 보기 / 새 워크스페이스** 바가 보이면 정상입니다.
`data/workspaces.json`은 첫 워크스페이스를 만들면 자동으로 생성됩니다.

---

## B. 기존 사용자가 `git pull` 받을 때

### 결론부터

- **마이그레이션 스크립트 실행이 필요 없습니다.**
- 기존에 생성해 둔 이미지와 그 메타데이터는 **그대로 유지**됩니다.
- pull 직후 기존 이미지는 모두 **전체 보기**에 그대로 나타납니다. (아직 어떤
  워크스페이스에도 배정되지 않은 상태)
- 원하는 이미지를 카드 hover 또는 상세 뷰어의 폴더 아이콘으로 워크스페이스에 배정하면 됩니다.

### 표준 절차 (복사해서 그대로 사용)

```bash
# 1) 로컬에 저장하지 않은 변경이 있으면 잠시 보관 (선택)
git stash

# 2) 최신 코드 받기 (auto-save 커밋과의 히스토리 정리를 위해 rebase 권장)
git pull --rebase

# 3) 의존성/빌드 산출물 갱신
npm install

# 4) 1)에서 stash 했다면 되돌리기 (선택)
git stash pop

# 5) 재시작
npm run dev
```

> 이 저장소는 `[davinci] auto-save ...` 형태의 자동 저장 커밋을 사용합니다. 로컬에
> 이런 커밋이 쌓여 원격과 갈라져 있으면 일반 `git pull`이 머지 커밋을 만들거나
> 충돌을 낼 수 있습니다. `git pull --rebase`를 쓰면 히스토리가 깔끔하게 정리됩니다.

---

## C. 충돌(conflict)이 났을 때 파일별 해결 가이드

`git pull` 도중 충돌이 보고되면, 아래 유형별로 처리합니다.

### 1) `data/workspaces.json` — 충돌 날 수 없음

gitignore 대상이라 git이 추적하지 않습니다. 이 파일 이름이 충돌 목록에 뜨는
경우는 **과거에 실수로 커밋된 적이 있을 때뿐**입니다. 그럴 때는 추적에서 빼고 로컬
파일은 그대로 둡니다.

```bash
git rm --cached data/workspaces.json
git commit -m "chore: stop tracking runtime workspaces.json"
```

`output/`, `uploads/`, `data/history/` 도 동일한 방식으로 정리합니다.

### 2) `data/model-catalog.json` — 전용 병합 드라이버로 자동 해결

이 파일은 공유되지만 로컬 항목이 달라질 수 있어 **로컬 우선 병합 드라이버**가
설정되어 있습니다. 클론/머신마다 **한 번만** 설정하면 이후 충돌이 자동 병합됩니다.

```bash
npm run setup:git-merge          # Windows: npm run setup:git-merge:win
```

- 이미 충돌이 난 상태라면 위 명령으로 드라이버를 설정한 뒤 다시 시도합니다.

  ```bash
  git checkout --merge -- data/model-catalog.json
  # 또는 pull을 중단(git merge --abort / git rebase --abort)하고 드라이버 설정 후 재시도
  ```
- 드라이버가 없어 수동 해결해야 한다면, 로컬에서 추가한 모델 항목을 유지하고 원격의
  새 항목을 함께 남기도록 병합합니다. (`scripts/merge-model-catalog.mjs`가 하는
  동작과 동일: 두 쪽 항목을 합치고 로컬 항목 우선)

### 3) 소스 코드 (`.ts` / `.tsx`) 충돌

이번 워크스페이스 작업이 건드린 주요 파일은 다음과 같습니다. pull 시 로컬에서 같은
파일을 수정했다면 여기서 충돌이 날 수 있습니다.

- `src/lib/store.ts` — 워크스페이스 상태/액션 추가
- `src/lib/types.ts` — `GeneratedImage.workspaces`, `Workspace`, `WorkspaceSummary`
- `src/lib/server-images.ts` — 이미지 목록의 워크스페이스 필터/부착, 삭제 시 정리
- `src/app/page.tsx` — 헤더에 `WorkspaceBar`, 생성 시 워크스페이스 전달
- `src/components/gallery.tsx` / `src/components/image-viewer.tsx` — `WorkspacePicker` 배치

신규 파일(충돌 없이 그대로 추가됨):
`src/lib/workspaces.ts`, `src/components/workspace-bar.tsx`,
`src/components/workspace-picker.tsx`,
`src/app/api/workspaces/route.ts`, `src/app/api/workspaces/[id]/route.ts`,
`src/app/api/images/[filename]/workspaces/route.ts`

충돌 해결 후에는 반드시 검증합니다.

```bash
npx tsc --noEmit     # 타입 오류 없어야 함
npm run lint         # 기존 경고 외 새 오류 없어야 함
```

---

## D. 적용 확인 (Verify)

```bash
npm run dev
```

1. 갤러리 상단에 **전체 보기 / 새 워크스페이스** 바가 보인다.
2. **새 워크스페이스**로 하나 만들면 칩이 추가되고, `data/workspaces.json`이 생성된다.
3. 그 워크스페이스를 선택한 상태에서 이미지를 생성하면 자동으로 그 워크스페이스에 담긴다.
4. 이미지 카드에 마우스를 올려 폴더 아이콘 → 워크스페이스 체크로 지정/해제가 된다.
5. **전체 보기**로 돌아오면 모든 이미지가 다시 보인다.

문제가 없으면 완료입니다. 되돌리려면 `data/workspaces.json`을 삭제하면 모든
워크스페이스 배정이 초기화됩니다 (이미지는 삭제되지 않습니다).

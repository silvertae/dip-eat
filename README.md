# 찍먹 (dipeat)

해외 식당에서 **메뉴판을 사진 한 장 찍으면** 해석·설명·주문까지 이어주는 PWA.

- 프론트: React + TypeScript + Vite + Tailwind v4 → **Vercel**
- 백엔드: Python 3.13 + FastAPI → **Google Cloud Run (서울 asia-northeast3)**
- AI: **Gemini 원샷** — 사진 1장에서 OCR·번역·구조화를 한 번에 (Vision API 별도 호출 없음)

## 모델 구성

| | 모델 | 이유 |
|---|---|---|
| 1차 | `gemini-3.1-flash-lite` | GA·저비용($0.25/$1.50 per 1M)·저지연. 대부분의 인쇄 메뉴판은 여기서 끝난다 |
| 폴백 | `gemini-3.5-flash` | 1차가 못 읽었을 때만 올라간다 |

`extract_menu` 는 1차 모델로 2회 시도한 뒤 폴백으로 넘어가므로, 이 구성이 그대로
**"싸게 먼저, 안 되면 좋은 걸로" 에스컬레이션**이 된다. 잘 읽히는 사진은 Lite 값만 내고,
손글씨·저조도처럼 어려운 사진만 상위 모델 비용을 낸다.

`thinking_level` 은 `low` 로 명시한다 — 기본값 `high` 를 그대로 두면 지연이 2~4배가 되고
thinking 토큰이 **출력** 단가로 과금된다. Flash-Lite 는 `minimal` 도 지원한다.

> ⚠️ Flash-Lite 는 효율 티어라 **손글씨 벽보에서 정확도가 떨어질 수 있다.**
> 실사진 벤치(아래)로 1차 모델을 Lite 로 둘지 Flash 로 둘지 확정할 것.
> `media_resolution` 이 Flash-Lite 에서 지원되는지도 문서로 확정되지 않았다 —
> 400 이 나면 `DIPEAT_GEMINI_MEDIA_RESOLUTION=` (빈 값)으로 끄면 전송하지 않는다.

개발 계획 전문: `~/.claude/plans/hazy-enchanting-hare.md`

---

## 현재 상태 — Phase 1 (수직 슬라이스)

사진 → 축소 → `POST /api/v1/menu/scan` → Gemini → 구조화 JSON → 결과 목록까지 관통.
목업의 화면·디자인은 Phase 2 이후에 입힌다.

| | 상태 |
|---|---|
| `POST /api/v1/menu/scan` | ✅ 동작 (Gemini 실호출까지 확인) |
| `GET /api/v1/health` | ✅ |
| 프론트 촬영→업로드→결과 | ✅ 최소 렌더 |
| 온보딩·홈·주문서·설정 화면 | ⬜ Phase 2~4 |
| PWA / 오프라인 캐시 | ⬜ Phase 5 |
| 결제 화면 | ❌ 범위 제외 |

---

## 로컬 실행

```bash
# 1) 백엔드
cd api
cp .env.example .env          # GEMINI_API_KEY 를 채운다 (https://aistudio.google.com/apikey)
uv sync
uv run uvicorn app.main:app --reload --port 8000
# 문서: http://127.0.0.1:8000/docs

# 2) 프론트 (다른 터미널)
cd web
npm install
npm run dev                   # http://localhost:5173
```

Vite 개발 서버가 `/api` 를 `127.0.0.1:8000` 으로 프록시한다. 프로덕션의 Vercel rewrites 와
같은 모양이라 **개발·프로덕션 모두 동일 출처가 되어 CORS 를 만나지 않는다.**

### 실기기(휴대폰) 테스트

`npm run dev -- --host` 만으로는 LAN 주소가 평문 http 라 **secure context 가 아니다.**
service worker 등록과 카메라 API 가 조용히 실패한다.

- Android: Chrome DevTools → Port forwarding (localhost 는 secure 로 취급됨). 인증서 작업 불필요.
- iOS: `mkcert` 인증서를 만들어 Vite `server.https` 에 물리고, 아이폰에 **구성 프로파일로 설치한 뒤
  설정 › 일반 › 정보 › 인증서 신뢰 설정**에서 신뢰까지 켜야 한다. 경고를 탭해 넘기는 것만으로는 부족하다.

### Phase 1 게이트 — 실사진 벤치

키를 넣은 뒤 **실제 메뉴판 사진 10장**(인쇄 / 손글씨 / 벽보 / 책자 / 저조도)을
`samples/` 에 넣고 돌린다. `samples/` 는 gitignore 되어 있다.

```bash
cd api
uv run python scripts/bench_menu.py ../samples                       # 1차 vs 폴백 비교
uv run python scripts/bench_menu.py ../samples --thinking minimal    # 더 싸게 되나?
uv run python scripts/bench_menu.py ../samples --no-media-resolution # 400 이 날 때
```

항목 수·가격 파싱률·저확신 비율·p50/p95 지연을 표로 출력하고, **읽어낸 메뉴명 전체**를
`docs/bench/bench-<시각>.json` 에 남긴다. 정답 메뉴판이 없으니 정확도(누락·환각)는
그 JSON 의 `read` 를 실제 사진과 눈으로 대조해서 판정한다. 항목 수가 많은 쪽이
이기는 게 아니다 — 환각도 항목 수를 늘린다.

### 테스트 / 타입 생성

```bash
cd api && uv run pytest              # 37개
cd web && npm run build              # tsc -b + vite build

# 백엔드 스키마를 바꾼 뒤 프론트 타입 재생성
cd api && uv run python -c "import json; from app.main import create_app; open('openapi.json','w').write(json.dumps(create_app().openapi(), ensure_ascii=False, indent=2))"
cd ../web && npm run gen:api
```

---

## 배포

### 백엔드 — Cloud Run

```bash
gcloud run deploy dipeat-api \
  --source ./api \
  --region asia-northeast3 \
  --allow-unauthenticated \
  --memory 1Gi --cpu 1 --timeout 120 \
  --set-secrets GEMINI_API_KEY=gemini-key:latest

gcloud run services describe dipeat-api --region asia-northeast3 --format='value(status.url)'
```

주의할 점:

- `--allow-unauthenticated` **필수**. 없으면 브라우저 프리플라이트(비인증 `OPTIONS`)가 FastAPI 에
  닿기 전에 IAM 에서 403 으로 잘린다. 증상만 보면 CORS 버그처럼 보여 한참 헤맨다.
- 메모리 **1Gi**. 256Mi 로 5MB 이미지를 디코드하면 OOM 이 랜덤 503 으로 나타난다.
- 첫 배포는 20~30분 예상 — gcloud 설치, 프로젝트 생성, 결제 계정 연결(무료 티어도 카드 필요),
  Cloud Run + Cloud Build API 활성화.
- `DIPEAT_DEBUG_ERRORS` 는 **설정하지 말 것.** 업스트림 원문 에러는 Cloud Run 로그에만 남긴다.

### 프론트 — Vercel

1. Vercel 프로젝트의 **Root Directory 를 `web/`** 으로 지정
2. `web/vercel.json` 의 `REPLACE-ME-...` 를 위에서 얻은 Cloud Run URL 로 교체
3. `/api/:path*` 리라이트가 `/(.*)` SPA 폴백보다 **먼저** 있어야 한다. 순서가 뒤집히면
   catch-all 이 API 호출을 삼켜 `index.html` 을 돌려주고 조용히 깨진다.

### 발표 당일

```bash
# 1시간 전 — 콜드스타트(~3초) 제거. 서울 기준 시간당 약 $0.08.
gcloud run services update dipeat-api --region asia-northeast3 --min-instances=1
curl -s https://<CLOUD_RUN_URL>/api/v1/health     # 워밍업

# 끝나고
gcloud run services update dipeat-api --region asia-northeast3 --min-instances=0
```

---

## 설계상 못 박은 것들

- **서버는 원화를 모른다.** 응답은 현지 통화만. ₩ 환산은 클라이언트가 한다 — 안 그러면 캐시된
  결과가 과거 환율에 박제된다.
- **알레르기 정보는 AI 추정이지 메뉴판에서 읽은 사실이 아니다.** 스키마 필드 이름이
  `likely_allergens` 이고 `inferred` / `basis` / `confidence` 를 함께 받는 이유다.
  UI 는 반드시 "AI 추정, 점원에게 확인" 고지를 노출한다. 식품 안전 문제다.
- **`name_local`(원문)은 절대 응답에서 빠지지 않는다.** 사용자가 점원에게 그 글자를 그대로 보여준다.
- **알레르기 차단은 클라이언트가 한다.** 서버는 후보만 주고 프로필 대조는 로컬에서 —
  프로필이 서버로 나가지 않고, 프로필을 바꿔도 재스캔이 필요 없다.
- **목업의 "현지 리뷰"를 LLM 으로 생성하지 않는다.** 지어낸 문장을 실제 후기처럼 보여주는 것이라
  "AI 한 줄 설명"으로 재라벨링하거나 섹션을 뺀다.

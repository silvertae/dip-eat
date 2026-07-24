# AGENTS.md

찍먹(dipeat) — 메뉴판 사진 1장을 구조화해 해석·주문·점원 대화까지 잇는 발표용 MVP.
모노레포: `web/`(React+TS+Vite 모바일 웹 → Vercel), `api/`(FastAPI → Cloud Run 서울).
설치형 PWA(오프라인 앱 셸·세션 복원·최근 식당 재열람)는 Phase 5 에서 구현했다.
배포·로컬 실행·실측 수치는 [README.md](README.md)에 있다. 이 파일은 **깨지기 쉬운 규칙**만 모은다.

## 명령어

```bash
cd api && uv run pytest                      # 55개
cd api && uv run uvicorn app.main:app --reload --reload-include '*.md' --port 8000
cd web && npm run dev                        # /api 는 127.0.0.1:8000 으로 프록시
cd web && npm run build                      # tsc -b + vite build
cd web && npm run lint

# 스키마를 바꿨으면 OpenAPI → TS 타입 재생성 (손으로 타입 쓰지 말 것)
cd api && uv run python -c "import json;from app.main import create_app;open('openapi.json','w').write(json.dumps(create_app().openapi(),ensure_ascii=False,indent=2))"
cd web && npm run gen:api

cd api && uv run python scripts/probe_models.py     # 이 키로 실제 응답하는 모델 확인 (배포 전)
cd api && uv run python scripts/bench_menu.py ../samples   # 실사진 정확도·지연 측정
```

## 아키텍처 — 2단계 호출

이 서비스의 지연은 거의 전부 **출력 토큰**에서 나온다(입력은 사진 크기와 무관하게 ~1,900 고정).
그래서 호출을 둘로 나눴다:

- `POST /api/v1/menu/scan` — 사진 → **목록**. 카드에 필요한 것만. 알레르기는 **코드만**, 설명은 **25자 한 줄**.
- `POST /api/v1/menu/item/explain` — 카드를 탭했을 때. 긴 설명·알레르기 근거·로마자. 사진을 다시 안 보내는 텍스트 전용(~2.3초).

## 점원 대화 (주문서/대화 화면)

- **주문 '카드'는 서버를 부르지 않는다.** `web/src/lib/orderPhrases.ts` 의 정적 문구로 클라이언트가 조립한다. 일본어 우선, 없는 언어는 폴백. 메뉴 항목은 `name_local`(이미 현지어)이라 번역 불필요. 스캔 세션은 Phase 5 부터 새로고침·재실행에도 복원되므로(아래 PWA), 이미 스캔한 식당의 주문 카드는 오프라인에서도 뜬다. (새 스캔·자유 발화 번역만 네트워크 필요.)
- `POST /api/v1/chat` — 자유 발화 텍스트 번역(ko2local/local2ko + 독음). 언어 무관. 현재 프런트는 빠른 문구·음성 UI만 제공하고, 자유 텍스트 입력 UI는 아직 없다.
- `POST /api/v1/chat/voice` — 홀드-투-토크 오디오 → Gemini 오디오로 **전사+번역**. 모델이 빈 받아쓰기를 반환하면 422 `unclear_audio`; 빈·과대·비오디오 업로드는 415로 거절된다.
- **push-to-talk**(`components/PushToTalkToggle.tsx`): 탭=언어 포커스 전환(스프링 썸 슬라이드), 홀드>170ms=녹음(소나+이퀄라이저). getUserMedia+MediaRecorder 를 쓰므로 iOS Safari/향후 설치형 PWA 에서 마이크 권한 이슈가 있다 — 권한 거부를 조용히 삼키지 말 것. 실제 마이크 녹음은 헤드리스에서 검증 불가(실기기 필요).
- 주문서(`/order`)와 대화(`/chat`)는 **독립 화면**, CTA 로 오간다(디자인 핸드오프 반영).

**목록 스키마(`MenuItemSummary`)에 필드를 추가하면 응답시간이 항목 수(최대 90개)만큼 곱해진다.**
`tests/test_explain_route.py::test_scan_list_stays_lean` 이 이걸 막는다.

필드를 꼭 추가해야 하면 **추측하지 말고 `scripts/bench_menu.py` 로 전후를 재라.**
기준선: 짧은 문자열 1개(`section`) 추가 = 출력 토큰 +6~12%, p50 +3%(15.6s→16.0s).
긴 문자열이나 객체 배열은 이보다 훨씬 비싸다 — `likely_allergens` 하나가 43% 였다.

## 절대 어기면 안 되는 것

**Gemini (`app/services/gemini.py`)**
- SDK 는 `google-genai` (`from google import genai`). `google.generativeai` / `genai.GenerativeModel(...)` 튜토리얼은 전부 구 SDK다.
- `response.parsed` 는 스키마 위반 시 예외 없이 **`None`** 이 된다(SDK가 삼킴). `isinstance` 로 확인하고 재시도하는 분기를 지울 것 → "메뉴 0개"가 조용히 나간다.
- `thinking_level` 기본값은 HIGH. 우리는 **`minimal`**(OCR은 추론 과제가 아님). config 에서 온다.
- 1차 `gemini-3.1-flash-lite` → 폴백 `gemini-3.6-flash`. `gemini-3.5-flash` 는 503-dead라 뺐다. 모델 ID 는 문서보다 빨리 바뀌므로 배포 전 `probe_models.py`.

**Pydantic 스키마 = Gemini `response_schema` (`app/schemas/menu.py`)**
- 필드 `description` 이 곧 **모델에 대한 지시문**이다. 성의 있게 쓸 것.
- 평평하게 유지: 최상위 1객체 + 배열 한 겹. `oneOf` 체인·재귀 타입 금지(OpenAPI 3.0 서브셋).

**프롬프트 (`app/prompts/*.md`)**
- 정확도의 핵심 레버다. 계층형(가격대별) 메뉴판 누락 같은 버그는 코드가 아니라 여기서 고쳤다. 모델 거동을 바꾸려면 여기부터.
- ⚠️ **`uvicorn --reload` 는 `.py` 만 감시한다**(`default_includes = ["*.py"]`). 프롬프트는 모듈 import 시점에 한 번 읽히므로, `--reload-include '*.md'` 없이 실행하면 **프롬프트를 고쳐도 조용히 반영되지 않는다.** 실제로 한 번 당했다 — "고쳤는데 그대로네?" 싶으면 이걸 먼저 의심할 것.

**업로드 크기 (`app/core/limits.py`)**
- 상한은 **두 곳**을 같이 올려야 한다: `BodySizeLimitMiddleware`(총량) + `patch_multipart_part_limit`(Starlette 파트 상한, 기본 1MB). 후자는 클래스 속성이 아니라 `Request.form` 기본 인자라 몽키패치다. Starlette 업그레이드 시 `tests/test_upload_limits.py` 를 볼 것.

**이미지 (`app/services/image.py`)**
- Pillow 는 `run_in_threadpool` 로 (❌ `asyncio.to_thread` — AnyIO CapacityLimiter 우회). 핸들러는 `async def` 유지.
- `content_type` 신뢰 금지 — 디코드된 `img.format` 으로 판단. `MAX_IMAGE_PIXELS = None` 금지.

**프론트 (`web/`)**
- 촬영은 `<input capture>` 하나. 사진 촬영에는 getUserMedia를 쓰지 않고 축소는 워커에서 한다. 음성 대화만 getUserMedia+MediaRecorder를 쓴다.
- **EXIF 회전 보정 코드를 직접 넣지 말 것** — 현행 브라우저가 `drawImage`에서 이미 적용, 넣으면 두 번 돈다.
- `.env` 는 `DIPEAT_` 접두사지만 `GEMINI_API_KEY` 도 alias 로 받는다(config.py). 로컬 디버깅은 `DIPEAT_DEBUG_ERRORS=true`(Cloud Run 금지).
**PWA · 오프라인 지속성 (Phase 5)**
- `vite-plugin-pwa` `registerType: 'prompt'` — **`autoUpdate` 금지**(업로드·녹음 중 SW 가 페이지를 리로드하면 작업이 날아간다). 새 버전은 `main.tsx` 에서 사용자에게 물어보고 활성화한다. 개발 모드는 SW 를 끈다(`devOptions.enabled:false`) — PWA 검증은 `npm run build && npm run preview`.
- **스캔 세션은 zustand persist(localStorage `dipeat:session`)** 로 동기 복원한다(`store/app.ts`). `partialize` 로 `scan`/`cart`/`convo`/`captureMode` 만 저장 — `preview`(objectURL)·`phase`·`error` 는 리로드에 못 살리거나 살리면 안 되는 값이라 제외. 부팅 시 `hydrate()`(main.tsx 에서 1회) 가 `phase='done'` 로 맞추고 `preview` 를 IndexedDB 의 Blob 으로 되살린다.
- **이미지 Blob·최근 식당은 IndexedDB(`lib/db.ts`, idb-keyval DB `dipeat`/store `recents`, 최근 12개).** 사진을 localStorage(base64)에 넣지 말 것(iOS 5MB 상한). 저장하는 건 원본(3~5MB)이 아니라 **업로드용 축소본**(~350~700KB)이다.
- 커먼즈 썸네일 런타임 캐시(`vite.config.ts` workbox runtimeCaching)는 `<img>` opaque 응답(status 0)이라 성공/실패를 구분 못 한다 → **CacheFirst 면 일시 404/429/5xx 가 30일 박제**된다. 그래서 `StaleWhileRevalidate`(다음 열람에 자가 치유) + `<img onError>` 이모지 폴백(`DishThumb`/`MenuCard`)을 함께 쓴다. `navigateFallback` 은 `/api` 를 denylist 로 제외(백엔드 호출을 셸로 가로채지 않게).
- 브랜드 아이콘(`public/pwa-*.png`, `apple-touch-icon-180x180.png`)은 홈 로고와 같은 오렌지 '찍' 마크다(favicon.svg 는 옛 템플릿 보라 마크라 아이콘 소스로 쓰지 말 것).

## 제품 불변식 (기능 아님)

- **서버는 원화를 모른다.** 현지 통화만 반환, ₩ 환산은 클라이언트(`web/src/lib/fx.ts`)가 볼 때마다 한다 — 캐시된 결과가 과거 환율에 박제되는 걸 막는다. 외부 API(open.er-api.com) + 하드코딩 폴백이라 발표 중 API 가 죽어도 ₩ 는 계속 나온다.
- **알레르기는 AI 추정이지 메뉴판에서 읽은 사실이 아니다.** `likely_allergens`/`inferred`/`basis`/`confidence`. UI 는 "AI 추정, 점원에게 확인" 상시 고지. 식품 안전 문제.
- **`name_local`(원문)은 절대 응답에서 빼지 않는다.** 사용자가 점원에게 그 글자를 보여준다.
- **알레르기 차단은 클라이언트가** 코드 대조로 한다(프로필이 서버로 안 나감).
- **목업의 "현지 리뷰"를 LLM 으로 생성하지 않는다**(조작된 후기). "AI 한 줄 설명"으로 재라벨링.
- **음식 사진은 '참고 이미지'지 그 가게의 음식이 아니다**(`web/src/lib/dishImage.ts`). 위키미디어 커먼즈를 브라우저에서 직접 검색한다(키 없음, `origin=*`). 위키백과 pageimages(문서 대표 이미지)는 문서 없는 흔한 요리를 놓쳐서 커먼즈 미디어 검색으로 바꿨다.
  - 검색어는 스캔 스키마의 `image_query`(Gemini 가 주는 영문/로마자, 예: `tamagoyaki`). 커먼즈 파일 제목이 대부분 영문이라 원문보다 잘 맞는다. 실패 시 `name_local` 로 재시도.
  - **정밀도 가드(`titleMatches`)**: 커먼즈는 전문 검색이라 오답이 섞인다(`ramen`→하늘을 나는 스파게티 괴물). 그래서 **파일 제목에 쿼리 토큰이 들어있는 것만** 채택. 못 맞히면 아이콘 — 남의 음식을 붙이는 것보다 낫다.
  - **저작권 표기는 법적 의무**: 커먼즈 사진은 대부분 CC-BY/BY-SA. `extmetadata` 에서 저작자·라이선스를 받아 상세에 표시한다(`Artist` 는 HTML 이라 태그·상용구 제거). 썸네일엔 '참고' 배지.
  - 우리 가드는 파일 **제목**만 본다. 파일 **내용**이 제목과 맞는지는 커먼즈를 신뢰한다.
  - **규칙을 손대면 실제 메뉴명으로 적중률·오답을 다시 재라**(커먼즈 API 는 브라우저에서 열림).

## 범위·진행

- **결제 화면은 범위 제외.** 현재 구현 화면은 온보딩·홈·촬영·결과·주문서·대화·설정·완료다. 목업 정본: `찍먹 목업.dc.html`(Claude Design).
- **Phase 5(설치형 PWA·오프라인 앱 셸·세션 복원·최근 식당)까지 구현됐다.** 디자인 토큰은 `web/src/styles/theme.css`(목업 CSS 변수 그대로).
- **미결:** 완료 화면(`/done`)은 라우트·코드만 있고 어느 흐름에서도 진입하지 않는다(디자인 재구성 때 주문 CTA 가 `/chat` 으로 바뀌며 빠짐). 어디에 다시 붙일지는 결정 안 됨.

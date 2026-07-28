# AGENTS.md

찍먹(dipeat) — 메뉴판 사진 1장을 구조화해 해석·주문·점원 대화까지 잇는 발표용 MVP.
모노레포: `web/`(React+TS+Vite 모바일 웹 → Vercel), `api/`(FastAPI → Cloud Run 서울).
설치형 PWA(오프라인 앱 셸·세션 복원·최근 식당 재열람)는 Phase 5 에서 구현했다.
**운영 배포 중이다** — 프론트 https://dip-eat.vercel.app, 백엔드 Cloud Run(서울), CI/CD 는 GitHub Actions.
배포·로컬 실행·실측 수치는 [README.md](README.md)에, 배포 근거 전문은 [docs/deploy.md](docs/deploy.md)에 있다.
이 파일은 **깨지기 쉬운 규칙**만 모은다.

## 명령어

```bash
cd api && uv run pytest                      # 91개
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
- `POST /api/v1/menu/scan/stream` — 위와 같은 결과를 **항목이 완성되는 대로** NDJSON 으로. 프런트는 이걸 쓴다.
- `POST /api/v1/menu/item/explain` — 카드를 탭했을 때. 긴 설명·알레르기 근거·로마자. 사진을 다시 안 보내는 텍스트 전용(~2.3초).

## 점원 대화 (주문서/대화 화면)

- **주문 '카드'는 서버를 부르지 않는다.** `web/src/lib/orderPhrases.ts` 의 정적 문구로 클라이언트가 조립한다. 일본어 우선, 없는 언어는 폴백. 메뉴 항목은 `name_local`(이미 현지어)이라 번역 불필요. 스캔 세션은 Phase 5 부터 새로고침·재실행에도 복원되므로(아래 PWA), 이미 스캔한 식당의 주문 카드는 오프라인에서도 뜬다. (새 스캔·자유 발화 번역만 네트워크 필요.)
- `POST /api/v1/chat` — 자유 발화 텍스트 번역(ko2local/local2ko + 독음). 언어 무관. 현재 프런트는 빠른 문구·음성 UI만 제공하고, 자유 텍스트 입력 UI는 아직 없다.
- `POST /api/v1/chat/voice` — 홀드-투-토크 오디오 → Gemini 오디오로 **전사+번역**. 모델이 빈 받아쓰기를 반환하면 422 `unclear_audio`; 빈·과대·비오디오 업로드는 415로 거절된다.
- **push-to-talk**(`components/PushToTalkToggle.tsx`): 탭=언어 포커스 전환(스프링 썸 슬라이드), 홀드>170ms=녹음(소나+이퀄라이저). getUserMedia+MediaRecorder 를 쓰므로 iOS Safari/향후 설치형 PWA 에서 마이크 권한 이슈가 있다 — 권한 거부를 조용히 삼키지 말 것. 실제 마이크 녹음은 헤드리스에서 검증 불가(실기기 필요).
- 주문서(`/order`)와 대화(`/chat`)는 **독립 화면**, CTA 로 오간다(디자인 핸드오프 반영).

### 스캔 스트리밍

지연은 **출력 토큰**에 비례하는데 첫 항목은 그와 무관하게 일찍 완성된다. 실측(samples/):
20개→첫 항목 1.55초(전체 10.2초) · 40개→2.70초(19.1초) · 54개→2.78초(26.1초).
**첫 항목 시각이 메뉴 크기와 거의 무관하다** — 큰 메뉴판일수록 이득이 크다.
브라우저 실측으로 결과 화면 진입이 26.7초 → **4.7초**(클라이언트 축소 포함).

- 증분 파싱은 `app/services/jsonstream.py`. 괄호 깊이 스캐너(문자열·이스케이프 인식)로
  완성된 원소만 꺼낸다. **조각 경계가 어디 떨어져도 결과가 같아야 한다** — `tests/test_jsonstream.py`
  가 한 글자씩 먹여서 이걸 지킨다.
- ⚠️ **스트리밍에는 `response.parsed` 가드가 없다**(`parsed` 자체가 없음). 대체물은
  **항목별 Pydantic 검증 + 0개면 `UnreadableMenu`** 다. 이걸 지우면 "메뉴 0개"가 조용히 나간다.
- ⚠️ **첫 항목 전까지는 아무것도 내보내지 않는다.** 그래야 그 전에 난 실패를 폴백 모델로
  넘길 수 있다. 이미 보낸 뒤 모델을 바꾸면 항목이 중복된다. (관측된 503 은 전부 첫 토큰 전이었다.)
- ⚠️ **HTTP 상태가 항상 200 이다.** 첫 바이트에 상태가 확정되므로 도중 오류를 4xx/5xx 로 못 바꾼다.
  오류는 본문의 `{"type":"error"}` 줄로 온다 — 클라이언트는 상태가 아니라 `type` 을 봐야 한다.
- ⚠️ `X-Accel-Buffering: no` 를 지우지 말 것. 중간 프록시가 버퍼링하면 스트리밍이 통째로 무의미해진다.
  (Vercel 프록시는 통과하는 것을 실측 확인했다.)
- ⚠️ 프런트 `persist` 는 **스트리밍 중 저장하지 않는다**(`partialize` 에서 제외). 항목마다 쓰면
  90개짜리에서 누적 1MB+ 를 직렬화해 모바일이 버벅인다. `done` 에서 한 번만 쓴다.
- ⚠️ 결과 화면의 자동 접기는 **다 받은 뒤에** 적용한다. 최초 렌더 때 판단하면 항목이 1개뿐이라
  영원히 안 접힌다(90개가 전부 펼쳐진 채 뜬다).

### 빈 사진 환각 방지 (`menu_found`)

모델은 **메뉴판이 없는 사진에 메뉴판을 통째로 지어낸다.** 실측(2026-07-28, 3회 재현):
흰 600×400 JPEG → `生ビール 550円` 등 8개, 회색 단색 → 8개, 어두운 프레임 → 5개.
전부 `ocr_confidence: "high"` 에 그럴듯한 가격이 붙었고, 스트림은 meta→item→done 으로
멀쩡히 끝났다. 사용자가 벽을 찍고 가짜 메뉴를 점원에게 보여주게 되는 **식품 안전 문제**다.

기존 가드는 전부 "항목이 0개일 때"만 돌아서 하나도 안 걸렸다. `ocr_confidence` 는
항목을 지어낸 그 모델의 자기 신고라 증거가 아니다.

- ⚠️⚠️ **`MenuExtraction.menu_found` / `no_menu_reason` 은 반드시 `items` 보다 앞 필드여야 한다.**
  Pydantic 필드 순서가 곧 Gemini 의 `property_ordering` 이다. 앞에 둬야 (a) 모델이 항목을
  쓰기 **전에** 판정을 선언하게 되고(그 선언이 뒤따르는 디코딩을 묶는다) (b) 스트리밍에서
  첫 항목이 나가기 전에 서버가 값을 읽고 끊을 수 있다. 뒤로 옮기면 둘 다 사라진다.
  `tests/test_no_menu.py::test_menu_found_is_declared_before_items_in_the_gemini_schema`.
- ⚠️ **`menu_found=false` 면 `items` 가 차 있어도 통째로 버린다.** 모델은 '없음'을 선언하고도
  항목을 채워 보낼 수 있다. 항목 수로 판단하는 분기를 다시 넣지 말 것.
- ⚠️ `NoMenuFound` 가 `UnreadableMenu` 를 **상속하는 것이 의도**다. 재시도·폴백 분기를 그대로
  타야 어두운 실사 메뉴판 오판을 상위 모델이 구제한다. 상속을 끊으면 어려운 사진을 잃는다.
- 비용: 최상위 필드 2개라 항목 수로 곱해지지 않는다. 실측(같은 항목 수 파일 5개) 출력 토큰
  −188 ~ +9, 즉 노이즈 범위. 실사진 10장 총 항목 433 → 440 으로 회귀 없음.
- ⚠️ 프롬프트·모델 ID 를 바꾸면 `tests/test_no_menu.py`(가짜)는 전부 통과하면서 환각만 되돌아온다.
  그때 유일한 그물이 **`DIPEAT_LIVE_TESTS=1 uv run pytest tests/test_no_menu_live.py`**(실 API).
  프롬프트를 손댔으면 이걸 돌릴 것.

**목록 스키마(`MenuItemSummary`)에 필드를 추가하면 응답시간이 항목 수(최대 90개)만큼 곱해진다.**
`tests/test_explain_route.py::test_scan_list_stays_lean` 이 이걸 막는다.

필드를 꼭 추가해야 하면 **추측하지 말고 `scripts/bench_menu.py` 로 전후를 재라.**
기준선: 짧은 문자열 1개(`section`) 추가 = 출력 토큰 +6~12%, p50 +3%(15.6s→16.0s).
긴 문자열이나 객체 배열은 이보다 훨씬 비싸다 — `likely_allergens` 하나가 43% 였다.
반대로 **타입만 바꾸는 건 사실상 공짜**다 — `price_amount` int→float 은 항목당 출력 토큰
148.7→146.2, p50 20.3s→19.1s(samples/ 10장, 노이즈 범위).

## 절대 어기면 안 되는 것

**Gemini (`app/services/gemini.py`)**
- SDK 는 `google-genai` (`from google import genai`). `google.generativeai` / `genai.GenerativeModel(...)` 튜토리얼은 전부 구 SDK다.
- `response.parsed` 는 스키마 위반 시 예외 없이 **`None`** 이 된다(SDK가 삼킴). `isinstance` 로 확인하고 재시도하는 분기를 지울 것 → "메뉴 0개"가 조용히 나간다.
- `thinking_level` 기본값은 HIGH. 우리는 **`minimal`**(OCR은 추론 과제가 아님). config 에서 온다.
- 1차 `gemini-3.1-flash-lite` → 폴백 `gemini-3.6-flash`. `gemini-3.5-flash` 는 503-dead라 뺐다. 모델 ID 는 문서보다 빨리 바뀌므로 배포 전 `probe_models.py`.
- ⚠️ **`probe_models.py` 는 설정된 모델이 죽어 있어도 `exit 0`** 이다(`⚠️` 만 출력). 게이트가 아니다 —
  그래서 `probe-models.yml` 이 출력에서 `⚠️` 를 grep 해 강제 실패시킨다. 손으로 돌릴 때는 눈으로 읽을 것.
  (2026-07-26 재확인: `gemini-3.5-flash` 가 지금은 응답한다. 되돌리지 않는다 — 폴백은 1차보다 **상위** 모델이어야 한다.)

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
- ⚠️⚠️ **커먼즈 썸네일 `<img>` 에서 `crossOrigin="anonymous"` 를 빼지 말 것**(`DishThumb`/`MenuCard`). 빼면 응답이 **opaque**(status 0)가 되고, 그걸 SW 가 캐시하는 순간 크롬이 크기 유출(storage-size oracle)을 막으려고 **항목마다 무작위 패딩을 quota 에 더한다**. 실측: 24KB 썸네일이 장당 **4.77MB**(181배)로 잡혀 92장 = **441MB**. `expiration` 은 **항목 수만 세므로 이걸 절대 못 잡는다**(maxEntries 200 → 최악 ~950MB). 게다가 `main.tsx` 의 `navigator.storage.persist()` 승격 탓에 자동 회수도 안 된다. 커먼즈는 ACAO 를 주므로 CORS 로 받아도 잘 뜬다. 같은 이유로 `cacheableResponse.statuses` 에 **0 을 다시 넣지 말 것**.
- 그래서 캐시 이름이 `wikimedia-thumbs-v2` 다(패딩된 옛 캐시와 분리). 옛 `wikimedia-thumbs` 는 `main.tsx` 가 1회 삭제한다 — workbox 의 `cleanupOutdatedCaches` 는 precache 만 건드린다.
- 썸네일 핸들러는 `StaleWhileRevalidate` + `<img onError>` 이모지 폴백이다. **SWR 을 고른 원래 이유(opaque 라 성공/실패를 구분 못 해 CacheFirst 면 일시 404/429/5xx 가 30일 박제됨)는 CORS 전환으로 사라졌다** — 이제 status 로 걸러내니 CacheFirst 도 안전하다. 바꾸려면 재검증 요청이 줄어드는 이득을 실제로 재고 바꿀 것. `navigateFallback` 은 `/api` 를 denylist 로 제외(백엔드 호출을 셸로 가로채지 않게).
- 브랜드 아이콘(`public/pwa-*.png`, `apple-touch-icon-180x180.png`)은 홈 로고와 같은 오렌지 '찍' 마크다(favicon.svg 는 옛 템플릿 보라 마크라 아이콘 소스로 쓰지 말 것).

**CI/CD (`.github/workflows/`, 근거는 [docs/deploy.md](docs/deploy.md) 7장)**
- ⚠️⚠️ **`main` 에 `api/**` 가 들어가면 그 자리에서 운영에 배포된다.** 예전 문서의 "머지는 배포가 아니다"는
  더 이상 사실이 아니다. `--no-traffic` candidate 로 띄워 스모크(`/health` + `POST /chat`)를 통과해야
  트래픽이 넘어가므로 안전장치는 있지만, **머지 = 배포**로 알고 움직일 것.
- ⚠️ **required status check 가 없다**(경로 필터 워크플로를 required 로 걸면 그 경로를 건드리지 않은 PR 이
  영구히 머지 불가가 된다 — deploy.md 7.9). 즉 **빨간 PR 도 머지 버튼이 눌린다.** 체크를 눈으로 볼 것.
- ⚠️ 스키마를 고치면 `openapi.json`·`api.gen.ts` **재생성본을 같이 커밋**해야 한다. `contract-drift.yml`
  이 재생성 후 diff 로 막는다. 단 `include_in_schema=False` 라우트(스트리밍)는 openapi 에 안 잡히므로 무관.
- ⚠️ 테스트는 **접두사 없는 `GEMINI_API_KEY`** 에 아무 문자열이라도 있어야 통과한다(`Settings(gemini_api_key=…)`
  는 alias 때문에 안 먹는다). `DIPEAT_GEMINI_API_KEY` 로 주면 `test_config` 가 깨진다. 네트워크는 안 탄다.
- ⚠️ `--set-env-vars` 는 환경변수를 **통째로 교체**한다. 콘솔에서 변수를 추가했으면 `api-deploy.yml` 에도
  같이 넣어야 다음 배포가 날리지 않는다. 콤마는 gcloud 가 먹으므로 `^@^` 구분자 유지.
- ⚠️ `api-deploy.yml` 에 `--min-instances 0` 이 박혀 있다 → **발표 당일 1 로 올려둔 상태에서 배포하면
  콜드스타트가 되돌아온다.** 그날은 배포하지 말 것.
- 액션 버전: `astral-sh/setup-uv` 는 이동 태그가 `v7` 에서 멈춰 있어 **전체 버전(`@v9.0.0`) 고정**이 필요하다.
  `openapi-typescript` 도 정확히 핀한다(떠다니면 코드를 안 고쳐도 어느 날 무관한 PR 이 막힌다).
- ruff 는 `uv.lock` 에 없다 → `uv run` 이 아니라 `uvx`. 현재 19건이 남아 **비차단**(`continue-on-error`)이다.

## 제품 불변식 (기능 아님)

- **서버는 원화를 모른다.** 현지 통화만 반환, ₩ 환산은 클라이언트(`web/src/lib/fx.ts`)가 볼 때마다 한다 — 캐시된 결과가 과거 환율에 박제되는 걸 막는다. 외부 API(open.er-api.com) + 하드코딩 폴백이라 발표 중 API 가 죽어도 ₩ 는 계속 나온다.
- **`price_amount` 는 소수다(`float`).** 정수로 두면 `$3.50`→`3` 으로 센트가 잘려 ₩ 환산·예산 게이지가
  ~14% 틀린다(주력 통화가 JPY·KRW 라 오래 안 보였다). `price_text` 는 여전히 적힌 그대로다 —
  **개별 항목은 `price_text` 를 그리고, `price_amount` 는 우리가 계산할 때만 쓴다.**
  정수 통화에 `970.0` 이 나오지 않게 스키마 설명과 프롬프트가 같이 막는다.
  `tests/test_scan_route.py::test_price_amount_keeps_cents` 가 회귀를 잡는다.
- **항목 자체는 '사진에서 읽은 것'이어야 한다.** 이 앱의 안전 고지는 전부 "메뉴는 진짜고 알레르기 추정만 불확실하다"를 전제로 쓰여 있다. 항목이 지어내진 것일 수 있으면 그 전제가 무너진다 — 그래서 빈 사진은 결과를 내는 대신 거절한다(위 `menu_found`). **항목 0개는 정상적인 답이다.**
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
- **그 뒤로 스캔 스트리밍(위 절)과 배포·CI/CD 가 들어갔다.** 운영 배포 완료, GitHub Actions 워크플로 5개 동작 중.
- **미결:**
  - 완료 화면(`/done`)은 라우트·코드만 있고 어느 흐름에서도 진입하지 않는다(디자인 재구성 때 주문 CTA 가 `/chat` 으로 바뀌며 빠짐). 어디에 다시 붙일지는 결정 안 됨.
  - **실기기(iOS Safari) 검증이 남아 있다** — PWA 설치·마이크 권한·폰 촬영본(3024×4032) 스캔. 헤드리스로는 불가.
  - `/api/v1/_probe/stream` 은 임시 진단 장치다. 스트리밍이 Vercel 을 통과함을 확인했으므로 지울 수 있다(deploy.md 부록 A).
  - ruff 19건 정리 → `api-ci.yml` 의 `continue-on-error` 제거.

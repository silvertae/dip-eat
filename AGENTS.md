# AGENTS.md

찍먹(dipeat) — 메뉴판 사진 1장을 구조화된 메뉴로 바꾸는 발표용 MVP.
모노레포: `web/`(React+TS+Vite PWA → Vercel), `api/`(FastAPI → Cloud Run 서울).
배포·로컬 실행·실측 수치는 [README.md](README.md)에 있다. 이 파일은 **깨지기 쉬운 규칙**만 모은다.

## 명령어

```bash
cd api && uv run pytest                      # 45개
cd api && uv run uvicorn app.main:app --reload --reload-include '*.md' --port 8000
cd web && npm run dev                        # /api 는 127.0.0.1:8000 으로 프록시
cd web && npm run build                      # tsc -b + vite build

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
- 촬영은 `<input capture>` 하나. getUserMedia 아님(iOS PWA 권한 지속 문제). 축소는 워커에서.
- **EXIF 회전 보정 코드를 직접 넣지 말 것** — 현행 브라우저가 `drawImage`에서 이미 적용, 넣으면 두 번 돈다.
- `.env` 는 `DIPEAT_` 접두사지만 `GEMINI_API_KEY` 도 alias 로 받는다(config.py). 로컬 디버깅은 `DIPEAT_DEBUG_ERRORS=true`(Cloud Run 금지).

## 제품 불변식 (기능 아님)

- **서버는 원화를 모른다.** 현지 통화만 반환, ₩ 환산은 클라이언트(`web/src/lib/fx.ts`)가 볼 때마다 한다 — 캐시된 결과가 과거 환율에 박제되는 걸 막는다. 외부 API(open.er-api.com) + 하드코딩 폴백이라 발표 중 API 가 죽어도 ₩ 는 계속 나온다.
- **알레르기는 AI 추정이지 메뉴판에서 읽은 사실이 아니다.** `likely_allergens`/`inferred`/`basis`/`confidence`. UI 는 "AI 추정, 점원에게 확인" 상시 고지. 식품 안전 문제.
- **`name_local`(원문)은 절대 응답에서 빼지 않는다.** 사용자가 점원에게 그 글자를 보여준다.
- **알레르기 차단은 클라이언트가** 코드 대조로 한다(프로필이 서버로 안 나감).
- **목업의 "현지 리뷰"를 LLM 으로 생성하지 않는다**(조작된 후기). "AI 한 줄 설명"으로 재라벨링.
- **음식 사진은 위키백과 '참고 이미지'지 그 가게의 음식이 아니다**(`web/src/lib/dishImage.ts`). 썸네일에 '참고' 배지, 상세에 출처와 "이 가게의 실제 음식 사진이 아니에요"를 붙인다. 문서 제목이 `name_local` 과 **정확히 같을 때만** 채택한다 — 검색 매칭을 허용하면 `グルクン唐揚`(자리돔 튀김)에 から揚げ(닭튀김), `てびちの煮付`에 TV 예능 페이지가 붙는다. 커버리지는 절반쯤이지만 남의 음식 사진을 붙이는 것보다 낫다.

## 범위·진행

- **결제 화면은 범위 제외.** 나머지 화면은 실동작. 목업 정본: `찍먹 목업.dc.html`(Claude Design).
- Phase 1(수직 슬라이스+API) 완료. **다음: Phase 2 — 목업 디자인 시스템 이식**. 디자인 토큰은 `web/src/styles/theme.css`(목업 CSS 변수 그대로).

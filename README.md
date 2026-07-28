# 찍먹 (dipeat)

해외 식당에서 **메뉴판을 사진 한 장 찍으면** 해석·설명·주문·점원 대화까지 이어주는 모바일 웹 MVP.
설치형 PWA(오프라인 앱 셸·세션 복원·최근 식당 재열람)까지 구현했다(Phase 5).

**운영 중:** https://dip-eat.vercel.app — 백엔드는 Cloud Run(서울), 배포는 GitHub Actions 로 자동화돼 있다.

- 프론트: React + TypeScript + Vite + Tailwind v4 → **Vercel**
- 백엔드: Python 3.13 + FastAPI → **Google Cloud Run (서울 asia-northeast3)**
- AI: **Gemini** — 사진 스캔은 1회 멀티모달 호출로 OCR·번역·구조화한다(Vision API 별도 호출 없음). 카드 상세와 점원 대화는 별도 호출이다.

## 모델 구성

| | 모델 | 이유 |
|---|---|---|
| 1차 | `gemini-3.1-flash-lite` | GA·저비용($0.25/$1.50 per 1M)·저지연. 대부분의 인쇄 메뉴판은 여기서 끝난다 |
| 폴백 | `gemini-3.6-flash` | 1차가 못 읽었을 때만 올라간다 |

> `gemini-3.5-flash` 를 폴백으로 뒀다가 실사진 5/5 전부 503(model overloaded)이 나서 교체했다.
> 배포 전 `uv run python scripts/probe_models.py` 로 **이 키에서 실제로 응답하는 모델**을 확인할 것 —
> 문서에 GA 로 적혀 있어도 503 이 계속 나면 폴백이 아니다.

`extract_menu` 는 1차 모델로 시도한 뒤 폴백으로 넘어가므로, 이 구성이 그대로
**"싸게 먼저, 안 되면 좋은 걸로" 에스컬레이션**이 된다. 잘 읽히는 사진은 Lite 값만 내고,
손글씨·저조도처럼 어려운 사진만 상위 모델 비용을 낸다.

> 모델당 시도 횟수는 로컬 기본값이 **2회**지만 **운영은 `DIPEAT_GEMINI_MAX_ATTEMPTS=1`** 이다.
> 2모델 × 2시도 × 45초 = 최악 183초로 Vercel 프록시의 120초 천장을 넘기 때문이다
> ([docs/deploy.md](docs/deploy.md) 6장). 최악 Gemini 비용도 정확히 절반이 된다.

`thinking_level` 은 **`minimal`**. 실측(사진 10장) 결과 `low` 는 thinking 토큰이 0~3,541 로
널뛰며 p50 19.6초였고, `minimal` 은 thinking 0 에 p50 15.6초이면서 추출량·가격 파싱률은
오히려 소폭 나았다. OCR+구조화는 추론보다 '읽기' 과제라 사고 예산이 도움이 안 된다.

### 왜 2단계로 나뉘어 있나

지연이 전부 **출력 토큰**에서 나온다(입력은 사진 크기와 무관하게 ~1,900 고정).
40개짜리 손글씨 벽보의 출력 9,565 토큰을 필드별로 쪼개보니:

| 필드 | 비중 |
|---|---|
| `likely_allergens` (항목마다 붙는 근거 문장) | **43.3%** |
| `description` | 22.3% |
| `tags` | 8.5% |
| `romanization` | 6.7% |

그래서 목록(`/menu/scan`)에는 카드에 바로 필요한 것만 담고 — 알레르기는 **코드만**,
설명은 **25자 한 줄** — 긴 설명·근거 문장·로마자는 카드를 탭했을 때
`/menu/item/explain` 으로 따로 받는다. 사진을 다시 보내지 않는 텍스트 전용 호출이라
**2.3초**면 끝나고, 사용자가 열지 않는 메뉴는 비용을 아예 내지 않는다.
알레르기 '차단'은 코드만 있으면 되므로 목록에서 그대로 동작한다.

**목록 스키마에 필드를 추가하면 항목 수만큼 곱해진다.** `tests/test_explain_route.py`
의 `test_scan_list_stays_lean` 이 이걸 지킨다.

### 스캔 스트리밍 — 총 시간이 아니라 첫 카드를 줄였다

출력 토큰이 지연을 만든다는 사실은 그대로다. 다만 **첫 항목은 전체 크기와 거의 무관하게 일찍 완성된다:**

| 항목 수 | 첫 항목 | 전체 |
|---|---|---|
| 20개 | 1.55초 | 10.2초 |
| 40개 | 2.70초 | 19.1초 |
| 54개 | 2.78초 | 26.1초 |

그래서 `/menu/scan/stream` 이 완성된 항목을 NDJSON 으로 흘려보낸다. 브라우저 실측으로
결과 화면 진입이 **26.7초 → 4.7초**(클라이언트 축소 포함). 총 시간은 그대로고 체감만 바뀐다 —
큰 메뉴판일수록 이득이 크다.

이 경로에는 비스트리밍 쪽에만 있던 안전망이 뒤늦게 붙었다. 타임아웃은 전체가 아니라 **청크 간
20초**다(전체 예산으로 걸면 89개짜리 정상 스캔이 45초라 죽는다). 모델이 MAX_TOKENS 로 끊겨
`items` 배열이 안 닫히면 "메뉴가 많아 일부만 읽었어요" 경고를 붙인다 — 그 전에는 61/90 이
완전한 메뉴로 보였다. 나머지 깨지기 쉬운 규칙(상태가 항상 200, 첫 항목 전까지 아무것도 안 보내는
이유 등)은 [AGENTS.md](AGENTS.md) 에 있다.

개발 계획 전문: `~/.claude/plans/hazy-enchanting-hare.md`

---

## 현재 상태 — 운영 배포 + 스캔 스트리밍

사진 → 축소 → `POST /api/v1/menu/scan/stream` → Gemini → 구조화 JSON → 결과·주문서·대화까지 관통한다.
목업 디자인 시스템은 결과·주문서·대화 화면에 이식돼 있다.

| | 상태 |
|---|---|
| `POST /api/v1/menu/scan` | ✅ 실사진 10장 검증 (10/10 성공, 가격 파싱 99%) |
| `POST /api/v1/menu/scan/stream` | ✅ **프런트가 쓰는 경로.** 항목이 완성되는 대로 NDJSON — 첫 카드 26.7초 → **4.7초** |
| 빈 사진 환각 거절 (`menu_found`) | ✅ 벽·바닥·단색 화면에 메뉴를 지어내던 것을 막는다 — [아래](#설계상-못-박은-것들) |
| `POST /api/v1/menu/item/explain` | ✅ 상세 조회, 실측 2.3초 |
| `GET /api/v1/health` | ✅ |
| `POST /api/v1/chat` | ✅ 자유 텍스트 번역 API. **현재 프론트는 이 경로를 쓰지 않는다**(대화 UI는 음성+빠른응답만) |
| `POST /api/v1/chat/voice` | ✅ 홀드-투-토크 오디오 → Gemini 오디오로 전사·번역 |
| 프론트 촬영→업로드→결과 | ✅ 분류 접기·필터·알레르기 경고·원화 환산·장바구니 |
| 온보딩·홈·주문서·설정 화면 | ✅ 프로필(알레르기·비선호·예산) 로컬 저장 |
| 주문서·대화 (독립 화면) | ✅ 오프라인 주문 카드(일본어) + push-to-talk 음성 통역 + 빠른 응답 |
| Wikimedia Commons 참고 이미지·저작권 표기 | ✅ (썸네일 오프라인 캐시 + 실패 시 이모지 폴백) |
| PWA(설치·오프라인 앱 셸·세션 복원·최근 식당) | ✅ Phase 5 — 아래 참조 |
| 배포 (Vercel + Cloud Run 서울) | ✅ https://dip-eat.vercel.app — 동일 출처 리라이트 관통 확인 |
| 자동 테스트 | ✅ 백엔드 pytest 127개 + 프론트 vitest 43개 — PR 에서 잡이 빨개진다(required check 는 없다) |
| CI/CD (GitHub Actions 5개) | ✅ main 의 `api/**` → 스모크 통과 후 자동 배포. [아래](#배포--cicd) |
| 결제·주문 완료 화면 | 결제 ❌ 범위 제외 / 완료 화면(`/done`)은 코드만 있고 현재 흐름에서 빠짐 |
| 실기기(iOS) 검증 | ⬜ **미완** — PWA 설치·마이크 권한·폰 촬영본 스캔. 헤드리스로는 불가 |

> **Phase 5 (PWA·오프라인).** `vite-plugin-pwa`(`registerType: 'prompt'` — 업로드·녹음 중
> 강제 리로드 금지). 스캔 세션(결과·장바구니·대화)은 zustand persist(localStorage
> `dipeat:session`)로 **동기 복원**돼 새로고침·재실행에도 화면이 살아남는다. 촬영 축소본과
> 최근 식당 목록은 IndexedDB(`idb-keyval`, 최근 12개)에 저장한다 — 사진은 iOS 5MB 상한 때문에
> localStorage 에 넣지 않는다. 새 스캔은 네트워크가 필요하지만, **이미 스캔한 식당은 오프라인에서
> 다시 열 수 있다.**

> **대화 화면**은 목업 핸드오프대로 push-to-talk 세그먼트 토글이다 — 탭=언어 전환(스프링
> 썸 슬라이드), 홀드>170ms=녹음(소나+이퀄라이저), 떼면 전송. `나` 홀드→내 한국어를 일본어로,
> `점원` 홀드→점원 일본어를 한국어로. `<input capture>`로는 홀드 제스처가 안 돼 getUserMedia를
> 쓰므로 iOS PWA 마이크 권한 이슈가 카메라와 동일하게 있다.

---

## 로컬 실행

```bash
# 1) 백엔드
cd api
cp .env.example .env          # GEMINI_API_KEY 를 채운다 (https://aistudio.google.com/apikey)
uv sync
uv run uvicorn app.main:app --reload --reload-include '*.md' --port 8000
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
현재 사진 촬영은 `<input capture>`라 LAN에서도 열리지만, 음성 대화의 `getUserMedia`와
service worker/PWA(설치·오프라인)는 HTTPS가 필요하다 — 실기기 PWA 검증은 mkcert 인증서 또는
**운영 도메인**(https://dip-eat.vercel.app)으로. (개발 모드는 SW 를 끈다 — `npm run build && npm run preview` 로 검증.)

> ⚠️ **Vercel 프리뷰 URL 로는 안 된다.** Standard Protection 이 기본 ON 이라 프리뷰 URL 이 Vercel
> 로그인을 요구하고, Hobby 는 공유 링크 1개 / 외부 사용자 1명으로 제한된다. 폰에서 그냥 열리지 않는다.

- Android: Chrome DevTools → Port forwarding (localhost 는 secure 로 취급됨). 음성 대화 테스트에 인증서 작업 불필요.
- iOS: `mkcert` 인증서를 만들어 Vite `server.https` 에 물리고, 아이폰에 **구성 프로파일로 설치한 뒤
  설정 › 일반 › 정보 › 인증서 신뢰 설정**에서 신뢰까지 켜야 한다. 경고를 탭해 넘기는 것만으로는 부족하다.

### 메뉴 스캔 품질 게이트 — 실사진 벤치

키를 넣은 뒤 **실제 메뉴판 사진 10장**(인쇄 / 손글씨 / 벽보 / 책자 / 저조도)을
`samples/` 에 넣고 돌린다. `samples/` 는 gitignore 되어 있다.

```bash
cd api
uv run python scripts/bench_menu.py ../samples                       # 1차 vs 폴백 비교
uv run python scripts/bench_menu.py ../samples --thinking minimal    # 더 싸게 되나?
uv run python scripts/bench_menu.py ../samples --no-media-resolution # 400 이 날 때
```

항목 수·가격 파싱률·저확신 비율·토큰·p50/p95 를 표로 출력하고, **읽어낸 메뉴명 전체**를
`docs/bench/bench-<시각>.json` 에 남긴다. 정답 메뉴판이 없으니 정확도(누락·환각)는
그 JSON 의 `read` 를 실제 사진과 눈으로 대조해서 판정한다. 항목 수가 많은 쪽이
이기는 게 아니다 — 환각도 항목 수를 늘린다.

**웹 이미지 10장(0.1~1.6MP) 기준 실측:**

| | |
|---|---|
| 성공률 | 10/10 |
| 가격 파싱률 | 99% |
| 항목 수 | 19~90 (평균 50) |
| 지연 p50 / p95 | 15.6초 / 27.3초 |
| 재현성 | 10장 중 6장 변동 0%, 최악 14% |

정답을 직접 센 손글씨 3단 벽보(`ゆうなんぎい`, 40개)에서 **40개 정확히 일치**, 가격 전량 일치.

> ⚠️ 아직 **폰 촬영본(3024×4032)으로는 검증하지 못했다.** 위 샘플은 전부 웹 이미지라
> 최대 1.6MP다. 실제 촬영본은 10~40배 크다. 파이프라인은 축소만 하고 확대는 안 하므로
> 저해상도에서의 거동이 실사용을 대표하지 않는다.

### 테스트 / 타입 생성

```bash
cd api && uv run pytest              # 127개
cd web && npm test                   # vitest 43개 (watch 는 npm run test:watch)
cd web && npm run build              # tsc -b + vite build
cd web && npm run lint               # oxlint

# 백엔드 스키마를 바꾼 뒤 프론트 타입 재생성 — 재생성본을 반드시 같이 커밋한다(CI 가 diff 로 막는다)
cd api && uv run python -c "import json; from app.main import create_app; open('openapi.json','w').write(json.dumps(create_app().openapi(), ensure_ascii=False, indent=2))"
cd ../web && npm run gen:api
```

> ⚠️ **테스트는 `GEMINI_API_KEY` 가 (아무 문자열이라도) 있어야 통과한다.** 네트워크는 타지 않지만
> `GeminiService.__init__` 이 빈 키를 거부해서, 키 없는 깨끗한 체크아웃에서는 16개가 깨진다.
> 워크트리·CI 에서는 `GEMINI_API_KEY=ci-dummy uv run pytest -q`. **접두사 없는 이름**으로 줄 것 —
> `DIPEAT_GEMINI_API_KEY` 로 주면 `test_config` 가 깨진다.

프론트 테스트(vitest)는 러너를 `web/vitest.config.ts` 에서 `environment: 'node'` 로 돌린다 —
jsdom 없이 node 22 의 `ReadableStream`·`FormData`·`Blob` 을 그대로 쓰고, `localStorage` 만
`src/test/setup.ts` 가 메모리로 심는다. 지금 덮는 건 **회귀가 조용한 두 지점**이다:
낡은 스캔 가드(`store/app.test.ts` — 스트리밍 중 새 스캔을 시작했을 때의 경합)와
NDJSON 파싱(`lib/api.test.ts` — 청크 경계 독립성을 바이트 단위로 스윕, 백엔드
`test_jsonstream.py` 의 클라이언트 짝). 순수 lib 는 아직 미커버다.

`DIPEAT_LIVE_TESTS=1` 을 주면 실 Gemini 를 부르는 12개가 추가로 돈다(`tests/test_no_menu_live.py`,
과금됨). 평소엔 skip 이지만 **프롬프트나 모델 ID 를 바꿨으면 돌릴 것** — 가짜 테스트는 전부
통과하면서 빈 사진 환각만 되돌아올 수 있다.

---

## 배포 · CI/CD

**이미 배포돼 있다.** 왜 이 조합인지, 각 플래그가 왜 그 값인지, 비용은 얼마인지는
[**docs/deploy.md**](docs/deploy.md) 에 전부 있다 — 여기는 **매일 필요한 것만** 남긴다.

| | |
|---|---|
| 프론트 | https://dip-eat.vercel.app (Vercel, Root Directory `web/`, Node 22.x) |
| 백엔드 | `https://dipeat-api-178327258666.asia-northeast3.run.app` (Cloud Run 서울) |
| 이어주는 것 | `web/vercel.json` 의 `/api/:path*` 리라이트 → **동일 출처라 CORS 프리플라이트가 없다** |

### 자동 배포 — `main` 의 `api/**`

```
push main (api/**) → pytest → amd64 빌드 → --no-traffic candidate 배포
                   → 스모크 3종 → 통과하면 트래픽 100% 전환 → :latest 태그 이동
```

스모크는 `/health`(시크릿·모델), `POST /chat`(라우팅), 그리고 **14KB 합성 메뉴판을
`/menu/scan/stream` 에 실제로 업로드**하는 것 세 가지다. 앞의 둘은 전부 텍스트 전용이라
멀티파트 파싱·업로드 상한·Pillow 디코드·NDJSON 프레이밍을 하나도 안 건드린다 — 그중 하나가
깨지면 **CI 초록 + 스모크 통과 상태로 모든 사진 업로드가 죽는다.** 그 스트림 응답은 실패해도
HTTP 200 이라 상태 코드로는 못 거른다. 프런트가 보는 것과 같은 조건(meta 로 시작 · error 줄
없음 · item 1개 이상 · done 으로 끝)을 `jq` 로 확인한다.

`:latest` 는 **스모크를 통과한 뒤에만** 붙는다 — 수동 복구 절차가 `:latest` 를 가리키므로,
빌드 시점에 붙이면 떨어진 이미지를 손으로 운영에 올리는 길이 열린다.

⚠️ **머지 = 배포다.** 스모크에서 떨어지면 candidate 는 트래픽 0 이라 운영은 이전 리비전에 그대로 남는다.
서비스 계정 사칭은 Workload Identity Federation 이므로 **배포 경로에 GitHub Secret 이 없다**
(`GEMINI_API_KEY` 시크릿은 매일 도는 `probe-models` 전용).

| 워크플로 | 트리거 |
|---|---|
| `api-ci` / `web-ci` | PR — `pytest` / `oxlint` + `vitest` + `tsc -b` |
| `api-deploy` | push `main` + `api/**` — 위 파이프라인 |
| `contract-drift` | PR — `openapi.json`·`api.gen.ts` 재생성 후 diff |
| `probe-models` | 매일 00:00 UTC — 1차·폴백 모델 생존 확인 |

required status check 는 **일부러 걸지 않았다**(경로 필터 워크플로를 required 로 걸면 그 경로를 건드리지
않은 PR 이 영구히 머지 불가가 된다 — deploy.md 7.9). **빨간 PR 도 머지되므로 체크는 눈으로 볼 것.**

### 손으로 배포해야 할 때

```bash
gh workflow run api-deploy.yml --ref main     # 파이프라인을 그대로 다시 태운다 (권장)
```

로컬에서 직접 밀어야 하면 [docs/deploy.md 8장](docs/deploy.md) 을 볼 것.
⚠️ **애플 실리콘에서 `--platform linux/amd64` 를 빼면 Cloud Run 이 `Container failed to start` 한 줄만
남기고 죽는다.** 그리고 `--set-env-vars` 는 환경변수를 통째로 교체한다.

### 발표 당일

```bash
# 1시간 전 — 콜드스타트(~3초) 제거. 2GiB 기준 시간당 약 $0.09.
gcloud run services update dipeat-api --region asia-northeast3 --min-instances=1
curl -s https://dipeat-api-178327258666.asia-northeast3.run.app/api/v1/health   # 워밍업

# 끝나고 ⚠️ 이걸 잊는 게 이 프로젝트의 1번 청구서 리스크다 (방치하면 월 ₩90,000)
gcloud run services update dipeat-api --region asia-northeast3 --min-instances=0
```

⚠️ **그날은 `api/**` 를 푸시하지 말 것** — `api-deploy` 에 `--min-instances 0` 이 박혀 있어
위에서 올린 1 이 되돌아간다.

### 알면서 남겨둔 것

- **공개 경로에 인증도 rate limit 도 없다.** `--max-instances 4` 가 유일한 집행 장치다.
- `DIPEAT_DEBUG_ERRORS` 는 **설정하지 말 것.** 업스트림 원문 에러는 Cloud Run 로그에만 남긴다.
- **PR 프리뷰가 운영 백엔드를 공유한다**(리라이트 목적지에 환경변수를 못 쓴다) → 프리뷰에서 스캔하면
  운영 Gemini 비용이 나간다.
- 나머지는 [docs/deploy.md 12장](docs/deploy.md).

---

## 설계상 못 박은 것들

- **항목은 사진에서 읽은 것이어야 한다 — 빈 사진에는 결과를 내지 않는다.** 모델은 흰 화면·벽·
  풍경에도 `生ビール 550円` 같은 메뉴를 통째로 지어냈다(실측 3회 재현, 전부 `ocr_confidence: high`).
  이 앱의 안전 고지는 전부 "메뉴는 진짜고 알레르기 추정만 불확실하다"를 전제로 쓰여 있어서,
  항목이 지어내진 것일 수 있으면 그 전제가 무너진다. 그래서 스키마 최상위에 `menu_found` 를 두고
  — `items` **보다 앞 필드**여야 모델이 항목을 쓰기 전에 판정을 선언한다 — false 면 항목이 차 있어도
  통째로 버린다. **항목 0개는 정상적인 답이다.**
- **서버는 원화를 모른다.** 응답은 현지 통화만. ₩ 환산은 클라이언트가 한다 — 안 그러면 캐시된
  결과가 과거 환율에 박제된다.
- **`price_amount` 는 소수(`float`)다.** 정수였을 때 `$3.50` → `3` 으로 센트가 잘려 ₩ 환산·예산
  게이지가 ~14% 틀렸다(주력 통화가 JPY·KRW 라 오래 안 보였다). 화면에 그리는 건 여전히
  `price_text`(적힌 그대로)고, `price_amount` 는 우리가 계산할 때만 쓴다.
- **알레르기 정보는 AI 추정이지 메뉴판에서 읽은 사실이 아니다.** 상세 응답의 필드 이름이
  `likely_allergens` 이고 `inferred` / `basis` / `confidence` 를 함께 받는 이유다.
  UI 는 반드시 "AI 추정, 점원에게 확인" 고지를 노출한다. 식품 안전 문제다.
- **`name_local`(원문)은 절대 응답에서 빠지지 않는다.** 사용자가 점원에게 그 글자를 그대로 보여준다.
- **알레르기 차단은 클라이언트가 한다.** 서버는 후보만 주고 프로필 대조는 로컬에서 —
  프로필이 서버로 나가지 않고, 프로필을 바꿔도 재스캔이 필요 없다.
- **주문 카드는 서버를 부르지 않는다.** `name_local`(이미 현지어) + 정적 문구 테이블로
  클라이언트가 조립한다 — 오프라인에서도 점원에게 보여줄 수 있어야 하므로. 자유 발화만 `/chat`.
- **음식 사진은 위키미디어 커먼즈 '참고 이미지'지 그 가게의 음식이 아니다.** 파일 제목이
  검색어와 정확히 맞을 때만 채택하고(오답 방지), CC-BY 저작자·라이선스를 상세에 표기한다.
- **목업의 "현지 리뷰"를 LLM 으로 생성하지 않는다.** 지어낸 문장을 실제 후기처럼 보여주는 것이라
  "AI 한 줄 설명"으로 재라벨링하거나 섹션을 뺀다.

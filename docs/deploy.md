# 배포 — 찍먹(dipeat)

프론트 **Vercel**, 백엔드 **Cloud Run 서울**. GCP·Vercel 계정이 **하나도 없는 상태**에서 시작한다.

이 문서는 왜 이 조합인지, 어떤 숫자를 왜 그렇게 뒀는지를 적는다. 명령어는 전부 복붙 가능하다.
실행 순서만 알고 싶으면 [3장](#3-첫-배포-순서--닭과-달걀은-없다)부터, 발표 당일이면 [9장](#9-발표-당일-체크리스트)만 보면 된다.

---

## 0. 전체 그림 — 요청 하나가 지나가는 길

```
브라우저 ──POST /api/v1/menu/scan (~500KB JPEG)──► Vercel Edge
                                                      │  vercel.json rewrite
                                                      │  (동일 출처 → CORS 프리플라이트 없음)
                                                      ▼
                                              Cloud Run (asia-northeast3)
                                                      │  uvicorn 1프로세스
                                                      ▼
                                        generativelanguage.googleapis.com
```

프런트는 **같은 출처의 상대 경로**(`fetch('/api/v1/menu/scan')`)만 부른다.
`web/src/lib/api.ts` 어디에도 백엔드 절대 URL이나 `VITE_API_BASE` 가 없다.
→ **운영에서 `/api/*` 를 백엔드로 넘기는 리라이트가 없으면 앱은 그냥 동작하지 않는다.** CORS 는 폴백일 뿐이다.

### 타임아웃 사다리 — 아래층이 위층보다 항상 짧아야 한다

| 층 | 값 | 누가 정하나 |
|---|---|---|
| 앱 내부 최악 재시도 체인 | **90초** | `DIPEAT_GEMINI_MAX_ATTEMPTS=1` ([6장](#6-183초-문제--환경변수-하나로-끝난다)) |
| Cloud Run `--timeout` | **105초** | 우리가 지정 |
| Vercel 프록시 | **120초** | 고정. 전 플랜(Hobby/Pro/Enterprise) 공통, 변경 불가 |

순서가 뒤집히면 **우리 한국어 JSON 에러 대신 Vercel 의 `ROUTER_EXTERNAL_TARGET_ERROR` HTML** 이 나간다.
그러면 `api.ts` 의 `toApiError()` 가 JSON 파싱에 실패해 전부 "연결에 실패했어요"로 뭉개진다
(코드에 그 주석이 이미 있다: `JSON 이 아닌 응답(프록시 5xx 등)은 아래 일반 메시지로`).
실측 p50 15.6초 / p95 27.3초라 정상 요청은 이 사다리 근처에도 안 온다 — 이건 **병리적 경로용 안전장치**다.

---

## 1. 왜 Vercel + Cloud Run 인가

결론부터: **바꾸지 않는다.** 대안을 다 봤지만 이기는 게 없다.

### 기각한 후보들

| 후보 | 판정 | 결정적 이유 |
|---|---|---|
| Fly.io | ❌ | 도쿄만 있고 서울 없음. 2024-10 이후 무료 티어 폐지 |
| Railway | ❌ | 싱가포르(+70ms), 월 $5 최소, Hobby 는 scale-to-zero 없음 |
| Render | ❌ | 무료 티어가 15분 유휴 후 **콜드스타트 ~50초**. 발표 킬러 |
| AWS App Runner | ❌ | scale-to-zero 없음 — 최소 인스턴스가 상시 과금 |
| Vercel Python Functions | ❌ | Hobby 는 함수 리전이 미국 고정 → 한국→미국→Gemini 왕복. 게다가 Dockerfile 을 버리고 앱을 재구성해야 한다 |
| Cloudflare Workers | ❌ | Pyodide 런타임이라 Pillow·google-genai 가 안 돈다 |
| Koyeb | ❌ | 무료 티어가 유럽/미국 전용 + **512MB RAM** → Pillow 디코드 OOM |
| Scaleway Containers | ❌ | 유럽 리전만. 한·일에서 RTT 250ms+ |
| 네이버클라우드 / NHN Cloud | ❌ | 컨테이너 제품이 관리형 쿠버네티스뿐 → 워커 노드 상시 과금, **scale-to-zero 없음**. Cloud Run 대응 제품 부재 |
| Oracle Cloud Always Free (서울) | ⚠️❌ | 진짜 무료지만 (1) 유휴 인스턴스 **회수 정책** — 발표 전날 사라질 수 있다 (2) ARM 프로비저닝 실패가 잦다 (3) VM 이라 TLS·리버스프록시·OS 패치를 직접 한다. `*.run.app` 이 공짜로 주는 TLS 를 버리는 거래 |

**Cloud Run 만이 다섯을 동시에 만족한다:** 요청 기반 과금 + 진짜 scale-to-zero / 1~4GiB 메모리 자유 지정 /
무료 TLS 도메인 / **기존 `api/Dockerfile` 그대로** / 서울·도쿄 선택.

### ⚠️ 기존 근거 중 틀린 것 두 개

README/AGENTS 를 고칠 때 같이 정리할 것.

**1. "Gemini 와 같은 클라우드라 유리"는 사실이 아니다.**
AI Studio SDK 는 `generativelanguage.googleapis.com` **글로벌 엔드포인트**를 쓴다.
Cloud Run 에서 리전 내부로 빠지는 경로가 따로 있지 않다. 어느 클라우드에 있든 같은 공용 인터넷이다.
(Vertex AI 이관 경로가 열려 있다는 것만 사실이고, 그건 지금 쓰는 이점이 아니다.)

**2. 서울은 Cloud Run Tier 2 리전이다.**

| | asia-northeast1 (도쿄) | asia-northeast3 (서울) |
|---|---|---|
| 가격 티어 | **Tier 1** | **Tier 2** |
| vCPU-초 | $0.000024 | $0.0000336 (**+40%**) |
| GiB-초 | $0.0000025 | $0.0000035 (**+40%**) |

그리고 서울↔도쿄 RTT ~30ms 는 p50 15,600ms 대비 **0.19%** 다. **리전은 지연 결정 요인이 아니다.**

> **그럼에도 서울을 유지한다.** 발표가 한국에서 열리고, 500KB 업로드 leg 는 국내 통신사 경로가 유리하며,
> 차액이 월 몇 달러다. 다만 근거를 "서울이 빨라서"가 아니라 **"업로드 경로와 포지셔닝, 그리고 차액이 무의미해서"**
> 로 바꿔 적는다.
>
> ⚠️ **실서비스로 가면 도쿄를 재검토하라.** 우리 사용자는 *해외에 있는 한국인*이다 —
> 샘플 메뉴판이 전부 일본 것(`ゆうなんぎい`)인 게 그 증거다. 오사카 식당에서 쓰면 도쿄가 사용 지점에 더 가깝고,
> Tier 1 이라 더 싸다.

> ⚠️ 무료 티어(**180,000 vCPU-초 / 360,000 GiB-초 / 200만 요청**)가 Tier 2 리전에 *어떻게* 적용되는지는
> 출처마다 설명이 엇갈린다(전액 적용 / Tier 1 요율 기준 할인 / 미적용). 단정하지 말고
> **첫 달 결제 콘솔에서 실청구를 확인하라.** 어느 쪽이든 Gemini 가 청구서의 87~96% 라 총액은 안 바뀐다([10장](#10-비용)).

---

## 2. 처음 한 번 — 계정 0에서

첫 배포는 **20~30분** 예상. 무료 티어도 카드 등록이 필요하다.

### 2.1 GCP 프로젝트 · 결제 · API

> ✅ **프로젝트와 결제는 이미 되어 있다.** `dip-eat`(번호 `178327258666`), 결제 연결 확인됨.
> 아래 `projects create` 와 결제 연결은 **건너뛴다.** 남은 건 API 활성화부터다.

```bash
# gcloud 설치 후
gcloud auth login

export PROJECT_ID=dip-eat
export PROJECT_NUMBER=178327258666
export REGION=asia-northeast3
export SERVICE=dipeat-api
export AR_REPO=dipeat

gcloud config set project "$PROJECT_ID"
```

<details>
<summary>프로젝트를 처음부터 만들어야 한다면 (지금은 해당 없음)</summary>

```bash
gcloud projects create dip-eat          # 프로젝트 ID 는 전역 유일해야 한다
gcloud config set project dip-eat
```

결제 계정 연결은 **콘솔에서** 한다: https://console.cloud.google.com/billing → 프로젝트에 연결.
(CLI 로도 되지만 결제 계정 ID를 먼저 찾아야 해서 콘솔이 빠르다. 무료 티어도 카드가 필요하다.)

</details>

**API 활성화 — 이게 지금 시작점이다.** 조회해 보니 아래 다섯 개가 **하나도 켜져 있지 않다.**

```bash
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  iamcredentials.googleapis.com \
  cloudbuild.googleapis.com
```

### 2.2 프로젝트 번호 → 최종 URL 확정

```bash
gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)'   # → 178327258666
```

**최종 운영 URL 은 이미 확정됐다. 아직 아무것도 배포하지 않았는데도.**

```
https://dipeat-api-178327258666.asia-northeast3.run.app
```

DNS 세그먼트 `dipeat-api-178327258666` 는 23자로 63자 제한에 한참 못 미친다 → 결정적 URL 이 부여된다.
스모크용 태그 URL `candidate---dipeat-api-178327258666`(35자)도 마찬가지다. ([3장](#3-첫-배포-순서--닭과-달걀은-없다) 참고)

### 2.3 Artifact Registry

```bash
gcloud artifacts repositories create "$AR_REPO" \
  --repository-format=docker --location="$REGION" \
  --description="dipeat 컨테이너 이미지"
```

### 2.4 Secret Manager 에 Gemini 키

```bash
# ⚠️ echo 대신 printf — echo 는 개행을 붙이고, 그 개행이 API 키에 그대로 들어간다.
printf '%s' 'AIza...실제키...' | gcloud secrets create gemini-key --data-file=-

# 나중에 키를 갈 때
printf '%s' 'AIza...새키...' | gcloud secrets versions add gemini-key --data-file=-
```

### 2.5 서비스 계정 **두 개**

⚠️ **`--service-account` 를 지정하지 않으면 컨테이너가 Compute Engine 기본 SA 로 돈다. 그 SA 는 프로젝트 전체 Editor 다.**
컨테이너가 뚫리면 프로젝트가 통째로 뚫린다. 반드시 나눈다.

| SA | 정체 | 가진 권한 |
|---|---|---|
| `dipeat-api-run@` | **컨테이너가 쓰는 신원** | `gemini-key` 시크릿 **하나**에만 접근 |
| `gh-deployer@` | **GitHub Actions 가 사칭하는 신원** | 배포 권한. 런타임 권한은 없음 |

```bash
# 런타임 SA — 시크릿 하나만
gcloud iam service-accounts create dipeat-api-run --display-name="dipeat Cloud Run runtime"
gcloud secrets add-iam-policy-binding gemini-key \
  --member="serviceAccount:dipeat-api-run@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role=roles/secretmanager.secretAccessor

# 배포 SA
gcloud iam service-accounts create gh-deployer --display-name="GitHub Actions deployer"
for ROLE in roles/run.admin roles/artifactregistry.writer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:gh-deployer@${PROJECT_ID}.iam.gserviceaccount.com" --role="$ROLE"
done
# 배포 SA 가 런타임 SA 를 "달아줄" 수 있어야 한다. 이거 빠뜨리면 deploy 가 권한 오류로 죽는다.
gcloud iam service-accounts add-iam-policy-binding \
  "dipeat-api-run@${PROJECT_ID}.iam.gserviceaccount.com" \
  --member="serviceAccount:gh-deployer@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role=roles/iam.serviceAccountUser
```

### 2.6 Workload Identity Federation — JSON 키를 만들지 않는다

서비스 계정 JSON 키를 GitHub Secret 에 넣는 방식은 **유출되면 만료가 없다.** WIF 는 GitHub 이 발급한
단기 OIDC 토큰을 GCP 가 직접 검증하므로 저장할 비밀이 없다.

```bash
gcloud iam workload-identity-pools create github \
  --location=global --display-name="GitHub Actions"

# ⚠️ --attribute-condition 없이는 제공자 생성이 거부된다.
#    그리고 조건을 느슨하게 쓰면 '아무 리포나' 이 프로젝트에 배포할 수 있게 된다.
gcloud iam workload-identity-pools providers create-oidc dip-eat \
  --location=global --workload-identity-pool=github \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
  --attribute-condition="assertion.repository_owner == 'silvertae'"

# 이 리포에서 온 토큰만 gh-deployer 를 사칭할 수 있다
gcloud iam service-accounts add-iam-policy-binding \
  "gh-deployer@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/attribute.repository/silvertae/dip-eat"
```

### 2.7 Vercel

1. https://vercel.com 가입 → **GitHub 계정으로** 로그인
2. Add New → Project → `silvertae/dip-eat` import
3. ⚠️ **Root Directory 를 `web/` 로 지정.** Framework Preset 은 Vite 로 자동 감지된다
4. Node.js Version 드롭다운을 **22.x** 로 ([5.7](#57-node-버전-고정))

> ⚠️ **Vercel Hobby 는 Git *조직* 소유 리포에 연결할 수 없다.** `silvertae/dip-eat` 은 개인 리포라 통과한다.
> 나중에 조직으로 옮기면 Pro($20/월)가 강제된다.
>
> ⚠️ **Hobby 는 비상업용 ToS 다.** "발표용 MVP"는 괜찮지만 실서비스는 Pro 가 요건이다.

---

## 3. 첫 배포 순서 — 닭과 달걀은 없다

README 는 "배포 → URL 확인 → `vercel.json` 수정"이라는 왕복을 암시한다. **그럴 필요 없다.**

Cloud Run 은 서비스마다 **결정적(deterministic) URL** 을 기본으로 부여한다(DNS 세그먼트 63자 이하일 때):

```
https://[태그---]SERVICE-PROJECT_NUMBER.REGION.run.app
```

`PROJECT_NUMBER` 는 프로젝트를 만든 직후 조회되므로 **배포 전에 최종 URL 을 알 수 있다.**
(해시 기반 URL 도 함께 부여되지만 예측 불가다. 우리는 결정적 쪽을 쓴다.)

**이미 끝난 것:** ✅ GCP 프로젝트 `dip-eat` 생성 · ✅ 결제 연결 · ✅ 프로젝트 번호 `178327258666` →
운영 URL `https://dipeat-api-178327258666.asia-northeast3.run.app` **확정**.

| # | 단계 | 왜 이 순서인가 |
|---|---|---|
| 1 | **API 활성화 5개** ([2.1](#21-gcp-프로젝트--결제--api)) | ⬅ **실제 시작점.** 조회해 보니 `run`·`artifactregistry`·`secretmanager`·`iamcredentials`·`cloudbuild` 가 하나도 안 켜져 있다 |
| 2 | Artifact Registry + Secret Manager ([2.3](#23-artifact-registry), [2.4](#24-secret-manager-에-gemini-키)) | 배포가 이 둘을 참조한다 |
| 3 | SA 2개 + WIF ([2.5](#25-서비스-계정-두-개), [2.6](#26-workload-identity-federation--json-키를-만들지-않는다)) | |
| 4 | `web/vercel.json` 전문 교체 + `engines.node` 추가 → main 에 커밋 ([4장](#4-verceljson--고친-전문)) | **백엔드가 아직 없어도 된다.** URL 이 확정이니까 |
| 5 | **로컬에서 백엔드 최초 1회 수동 배포** ([8장](#8-로컬에서-손으로-배포할-때)) | 자동화 전에 사람이 한 번 성공시켜야, 실패했을 때 CI 문제인지 앱 문제인지 구분된다 |
| 6 | `curl .../api/v1/health` → `has_api_key: true` | 시크릿 배선 검증. 여기서 걸리면 이후는 의미 없다 |
| 7 | Vercel import → Root Directory `web/` → 배포 ([2.7](#27-vercel)) | 4번이 이미 커밋돼 있으니 첫 배포부터 정상 동작 |
| 8 | 운영 도메인에서 **실제 스캔 1회** | 동일 출처 리라이트 관통 확인 |
| 9 | `DIPEAT_CORS_ORIGINS` 를 확정된 Vercel 도메인으로 갱신 → 재배포 | Vercel 도메인은 프로젝트를 만들기 전엔 모른다 |
| 10 | 워크플로 5개 커밋 → `api/**` 를 건드려 파이프라인 첫 실전 ([7장](#7-cicd--워크플로-5개)) | 사람이 성공시킨 뒤에 자동화한다 |
| 11 | 예산 알림 + `--min-instances=0` 확인 ([10장](#10-비용)) | |

**남는 순환은 9번 하나뿐이고 무해하다** — 리라이트로 동일 출처가 되므로 `DIPEAT_CORS_ORIGINS` 가
비어 있어도 앱은 정상 동작한다. 5번(최초 배포)에서는 아예 생략하고 9번에서 채운다.

---

## 4. `vercel.json` — 고친 전문

`web/vercel.json` 전체를 아래로 교체한다. **프로젝트 번호가 이미 박혀 있으니 그대로 복붙하면 된다.**

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://dipeat-api-178327258666.asia-northeast3.run.app/api/:path*"
    },
    { "source": "/(.*)", "destination": "/index.html" }
  ],
  "headers": [
    {
      "source": "/sw.js",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=0, must-revalidate" }]
    },
    {
      "source": "/index.html",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=0, must-revalidate" }]
    },
    {
      "source": "/assets/(.*)",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
    }
  ]
}
```

- ⚠️ 커밋된 플레이스홀더는 **옛 URL 형식**(`-xxxx.a.run.app`)이다. 새 형식은 `-PROJECT_NUMBER.REGION.run.app` —
  단순 치환이 아니라 형태가 다르다.
- ⚠️ **`/api/:path*` 가 `/(.*)` SPA 폴백보다 위**에 있어야 한다. 뒤집히면 catch-all 이 API 호출을 삼켜
  `index.html` 을 200으로 돌려주고, 프런트는 JSON 파싱 실패로 "연결에 실패했어요"만 띄운다. 조용히 깨진다.
- ⚠️ **리라이트 목적지에는 환경변수를 못 쓴다.** 하드코딩이 유일한 길이고, 그래서 PR 프리뷰가
  운영 백엔드를 공유한다([12장](#12-알면서-남겨둔-것)).
- ⚠️ `sw.js` 를 길게 캐시하면 사용자가 **낡은 서비스워커에 갇힌다.** 위 헤더를 지우지 말 것.
- ⚠️ `npm run gen:api` 는 `../api/openapi.json`(= `web/` 바깥)을 읽는다.
  Root Directory 가 `web/` 이면 그 경로가 빌드 샌드박스에 없다 → **빌드 파이프라인에 절대 넣지 마라.**

`web/package.json` 에는 한 줄 추가([5.7](#57-node-버전-고정)):

```jsonc
"engines": { "node": "22.x" },
```

---

## 5. Cloud Run 설정값 — 왜 이 숫자인가

> ⚠️⚠️ **이 명령은 이미지가 이미 푸시돼 있다고 가정하는 "참조용 전문"이다.**
> 처음이라면 저장소가 비어 있으므로 그대로 치면 이렇게 실패한다:
>
> ```
> ERROR: (gcloud.run.deploy) Image 'asia-northeast3-docker.pkg.dev/dip-eat/dipeat/dipeat-api:latest' not found.
> ```
>
> **최초 1회는 [8장](#8-로컬에서-손으로-배포할-때)에서 이미지를 먼저 빌드·푸시하고 오라.**
> 이 절은 "각 플래그가 왜 이 값인가"를 설명하는 곳이지 실행 순서가 아니다.

배포 명령 전문(이미지가 있을 때):

```bash
gcloud run deploy "$SERVICE" \
  --image "${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/${SERVICE}:latest" \
  --region "$REGION" \
  --allow-unauthenticated \
  --service-account "dipeat-api-run@${PROJECT_ID}.iam.gserviceaccount.com" \
  --cpu 1 --memory 2Gi --cpu-boost \
  --concurrency 8 --max-instances 4 --min-instances 0 \
  --timeout 105 \
  --startup-probe httpGet.path=/api/v1/health,httpGet.port=8080,initialDelaySeconds=0,timeoutSeconds=3,periodSeconds=3,failureThreshold=10 \
  --set-secrets GEMINI_API_KEY=gemini-key:latest \
  --set-env-vars '^@^DIPEAT_GEMINI_MAX_ATTEMPTS=1@DIPEAT_MAX_UPLOAD_BYTES=2097152@DIPEAT_LOG_LEVEL=INFO'
```

| 플래그 | 값 | 근거 |
|---|---|---|
| `--allow-unauthenticated` | **필수** | 없으면 비인증 `OPTIONS` 프리플라이트가 FastAPI 에 닿기 전에 IAM 403 으로 잘린다. 증상만 보면 CORS 버그라 한참 헤맨다 |
| `--concurrency` | **8** | [5.1](#51---concurrency-8--pillow-메모리-천장) |
| `--memory` | **2Gi** | [5.2](#52---memory-2gi--이-문서에서-제일-싼-보험) |
| `--max-instances` | **4** | [5.3](#53---max-instances-4--gemini-폭발-반경) |
| `--timeout` | **105** | 120은 Vercel 프록시와 **동률**이라 Vercel 이 이긴다([0장](#타임아웃-사다리--아래층이-위층보다-항상-짧아야-한다)) |
| `--startup-probe` | `/api/v1/health` | [5.4](#54-스타트업-프로브--시크릿-오설정이-자동-롤백된다) |
| `--cpu-boost` | 켬 | 스타트업 동안만 CPU 2배. 과금은 그 몇 초에만 |
| `--min-instances` | **0** | 발표 1시간 전에만 1 ([9장](#9-발표-당일-체크리스트)) |
| `--service-account` | 전용 런타임 SA | 미지정 시 **프로젝트 Editor** 로 돈다([2.5](#25-서비스-계정-두-개)) |

### 5.1 `--concurrency 8` — Pillow 메모리 천장

현재 README 의 배포 명령에는 이 플래그가 **없다** → Cloud Run 기본값 **80** 이 적용된다.

메모리 압력을 만드는 건 동시 요청 수가 아니라 **`prepare_image` 안에 동시에 들어가 있는 요청 수**다.
15.6초 요청 중 Pillow 구간은 ~0.3초(≈2%)라 정상 트래픽에서는 디코드가 거의 겹치지 않는다.
문제는 적대적 입력이다:

| | 정상 (클라이언트 축소본) | 적대적 (8MiB JPEG → 60MP) |
|---|---|---|
| 디코드 RGB | 9.4 MB | 180 MB |
| `exif_transpose` + `convert` 사본 포함 | **~30 MB** | **~360 MB** |
| 1 GiB 에서 동시 허용 | 20+ | **1개** |
| 2 GiB 에서 동시 허용 | 50+ | 2~3개 |

- **기본값 80은 위험하다.** 발표장에서 30명이 동시에 탭하는 버스트가 실재하고,
  AnyIO CapacityLimiter 기본 40토큰은 큐일 뿐 메모리 가드가 아니다.
- **`--concurrency 1` 은 정반대로 틀렸다.** I/O 대기가 99%인 워크로드에서 concurrency 는 곧 인스턴스-초다.
  동시 10건이 concurrency 1이면 10인스턴스 × 16초 = 160 인스턴스-초, concurrency 10이면 16 인스턴스-초 — **10배** 차이.
- **8**: 버스트에서도 `8 × 30MB = 240MB` 로 2GiB 에 여유. `--max-instances 4` 와 곱해 32 동시 처리.

⚠️ **인증 없는 공개 엔드포인트에서 60MP 디코드는 플래그로 못 막는다.** 순수 설정 완화책은
`DIPEAT_MAX_UPLOAD_BYTES=2097152`(2MiB) — 클라이언트가 350~700KB 를 보내니 3~6배 여유이고,
8MiB 일 때보다 적대적 페이로드 구성 난이도를 크게 올린다. **진짜 해결은 코드**다([12장](#12-알면서-남겨둔-것)).

### 5.2 `--memory 2Gi` — 이 문서에서 제일 싼 보험

README 는 1Gi 다. Cloud Run 에서 vCPU 단가는 GiB 단가보다 **9.6배** 비싸다.
1→2GiB 는 **Cloud Run 요금 +9%**, 그런데 Cloud Run 은 전체 지출의 ~8%뿐이므로 **총지출 +0.7%**.
256Mi 로 5MB 이미지를 디코드하면 OOM 이 랜덤 503 으로 나타난다는 걸 이미 겪었으면, 1Gi 도 넉넉하지 않다.

### 5.3 `--max-instances 4` — Gemini 폭발 반경

**예산 알림은 알림이지 차단이 아니다.** 인스턴스 상한이 유일하게 *집행되는* 레버다.

4 × 8 = 32 동시 스캔, 스캔당 ~16초 → 최대 2 스캔/초 → 7,200 스캔/시간 → 이론상 **$58/시간**.
이 숫자가 불편하면 그게 정상이다. 발표에는 32 동시로 차고 넘치니 MVP 는 4로 두고, 실트래픽이 오면 올린다.

### 5.4 스타트업 프로브 — 시크릿 오설정이 자동 롤백된다

키가 없으면 lifespan 이 `RuntimeError` 를 던지고(`gemini.py:105`) uvicorn 이 죽는다
→ 프로브가 절대 통과 못 함 → 리비전이 Ready 가 되지 못함 → **트래픽이 이전 리비전에 그대로 남는다.**
`failureThreshold=10 × periodSeconds=3` = 30초 유예로, 콜드스타트 ~3초의 10배 여유다.

### 5.5 환경변수 — ⚠️ gcloud 콤마 지뢰

`--set-env-vars` 는 **콤마로 항목을 나눈다.** `DIPEAT_CORS_ORIGINS` 는 JSON 배열이라
원소를 둘 넣는 순간 콤마가 들어가고 gcloud 가 그 자리에서 쪼갠다.
그러면 pydantic 이 JSON 파싱에 실패해 **import 시점에 컨테이너가 죽는다.**

→ 커스텀 구분자 `^@^` 를 쓴다(첫 문자가 구분자 선언):

```bash
--set-env-vars '^@^DIPEAT_GEMINI_MAX_ATTEMPTS=1@DIPEAT_CORS_ORIGINS=["https://dipeat.vercel.app"]@DIPEAT_LOG_LEVEL=INFO'
```

| 변수 | 운영값 | 비고 |
|---|---|---|
| `GEMINI_API_KEY` | Secret Manager | `--set-secrets`. 절대 `--set-env-vars` 로 넣지 말 것(콘솔·배포 로그에 평문 노출) |
| `DIPEAT_GEMINI_MAX_ATTEMPTS` | **1** | [6장](#6-183초-문제--환경변수-하나로-끝난다) |
| `DIPEAT_MAX_UPLOAD_BYTES` | **2097152** | 8MiB → 2MiB. 클라이언트 축소본이 350~700KB라 여유 |
| `DIPEAT_CORS_ORIGINS` | `["https://<프로젝트>.vercel.app"]` | [5.6](#56-cors--리라이트를-쓰면-폴백일-뿐이다) |
| `DIPEAT_GEMINI_TIMEOUT_S` | **건드리지 않는다** | [6장](#6-183초-문제--환경변수-하나로-끝난다) |
| `DIPEAT_DEBUG_ERRORS` | **설정하지 말 것** | 업스트림 원문 에러가 응답에 실린다. Cloud Run 로그에만 남겨야 한다 |

### 5.6 CORS — 리라이트를 쓰면 폴백일 뿐이다

리라이트는 서버-대-서버라 `Origin` 헤더가 없다 → CORS 미들웨어를 그냥 통과한다.
즉 `DIPEAT_CORS_ORIGINS` 가 비어 있어도 앱은 동작한다. 그래도 폴백으로 정확한 도메인 하나를 넣어둔다.

- ⚠️ **`["*"]` 금지.** 인증 없는 공개 API 를 아무 사이트나 브라우저에서 부를 수 있게 된다.
- ⚠️ **`https://*.vercel.app` 같은 글롭은 조용히 아무것도 안 한다.** Starlette `allow_origins` 는
  정확히 일치하는 문자열만 본다(글롭은 `allow_origin_regex` 인데 이 앱은 안 쓴다).
  게다가 통했다면 **아무나 자기 Vercel 프로젝트에서 우리 API 를 부를 수 있다.**
- ⚠️ **프리뷰 URL 을 넣지 마라.** PR 프리뷰는 자기 배포본의 `vercel.json` 리라이트를 그대로 갖고 있어
  **자기도 동일 출처**다. CORS 항목이 필요 없다.

### 5.7 Node 버전 고정

로컬이 **v22.22.0** 이다. `web/` 에는 `engines` 도 `.nvmrc` 도 **없다** → Vercel 이 자기 기본 LTS 를 쓴다.
Vite 8 / TS 6 / `@types/node@^24` 가 요구하는 것보다 낮으면 실패가 `tsc` 안쪽 깊은 곳에서 난다.

두 군데 다 박는다: `web/package.json` 의 `"engines": { "node": "22.x" }` + Vercel Project Settings 의
Node.js Version 드롭다운(대시보드 값이 우선한다).

---

## 6. 183초 문제 — 환경변수 하나로 끝난다

`_with_fallback`(`api/app/services/gemini.py:218-233`)은 2모델 × `gemini_max_attempts=2` = **4회**,
각 `gemini_timeout_s=45` 초 + 모델당 `0.6×attempt` 백오프 → 최악 **183.6초**.
Vercel 의 120초 천장을 넘는다.

**코드를 읽어 확인한 것:** 타임아웃은 곱해지지 않는다 — `gemini.py:222` 가
`UpstreamTimeout`/`UpstreamRateLimited`/`UpstreamConfigError`/`UnclearAudio` 를 **즉시 re-raise** 한다.
곱해지는 건 `UnreadableMenu`(스키마 위반으로 `resp.parsed is None`)와 `UpstreamError`,
즉 **느리게 실패하는 비-타임아웃**이다. 좁은 경로지만 천장은 막아야 한다.

| 안 | 최악 체인 | p95=27.3초를 자르나 | 판정 |
|---|---|---|---|
| 현행 (45s × 2모델 × 2시도) | 183.6s | 아니오 | ❌ 120s 초과 |
| timeout 30s, attempts 2 | 123.6s | 아슬아슬 | ❌ 여전히 초과 |
| timeout 24s, attempts 2 | 99.6s | **예 — p95 를 자른다** | ❌ |
| **timeout 45s 유지, attempts 1** | **90s** | 아니오 | ✅ |

### `DIPEAT_GEMINI_MAX_ATTEMPTS=1` 만 설정한다

⚠️ **`DIPEAT_GEMINI_TIMEOUT_S` 는 건드리지 마라.** 45초는 실측 p95 27.3초의 1.65배로 이미 타이트하고,
그 p95 는 README 가 경고하듯 **0.1~1.6MP 웹 이미지 기준이라 폰 촬영본(10~40배)으로는 미검증**이다.
실제 p95 는 더 높을 수 있다. 측정한 값을 추측으로 줄이지 않는다.

왜 시도 축을 지우는 게 맞나: 같은 모델 재시도(temperature 0.2)의 기대 이득은
**상위 모델 에스컬레이션**보다 낮다. 축을 하나 지워야 한다면 덜 값어치 있는 쪽을 지운다.

**보너스: 최악 Gemini 비용도 정확히 절반이 된다.** 폴백 `gemini-3.6-flash` 는 출력 단가가
1차 `gemini-3.1-flash-lite` 의 **5배**라, 재시도 한 번을 줄이는 게 곧 비용 천장을 반으로 만든다.

---

## 7. CI/CD — 워크플로 5개

**프론트 배포는 Vercel Git 연동에 맡긴다.** GH Action 으로 `vercel deploy` 를 부르면
프리뷰 URL 자동 생성·PR 코멘트·원클릭 롤백을 전부 잃는다. 순수한 손해다.
GitHub Actions 는 **품질 게이트와 백엔드 배포만** 담당한다.

| 파일 | 트리거 | 경로 필터 | 역할 |
|---|---|---|---|
| `web-ci.yml` | `pull_request` | `web/**` | oxlint + **`npm run build`** |
| `api-ci.yml` | `pull_request` | `api/**` | `pytest` (+ ruff, [7.2](#72-ruff-는-uv-run-이-아니라-uvx--그리고-지금-켜면-13건이-터진다)) |
| `api-deploy.yml` | `push: main` | `api/**` | 테스트 → amd64 빌드 → `--no-traffic` 배포 → **스모크** → 트래픽 전환 |
| `contract-drift.yml` | `pull_request` | 스키마·라우트·산출물 | `openapi.json` + `api.gen.ts` 재생성 후 diff |
| `probe-models.yml` | 매일 크론 + 수동 | — | 모델 생존 확인 |

### 7.1 57개 테스트에는 **더미 키가 필요하다**

AGENTS.md 는 "55개"라고 하는데 **실제로는 57개**다(이 문서 작성 시점 실측). 그리고 더 중요한 것:

```bash
# 키 없이 → 16개 실패
env -u GEMINI_API_KEY -u DIPEAT_GEMINI_API_KEY uv run pytest -q
#   16 failed, 41 passed

# 접두사 없는 이름에 더미값 → 전부 통과
GEMINI_API_KEY=ci-dummy-not-a-real-key uv run pytest -q
#   57 passed
```

**원인:** `tests/test_gemini_service.py:25` 는 `Settings(gemini_api_key="test-key")` 로 키를 주는 것처럼 보이지만,
`Settings.gemini_api_key` 는 `AliasChoices("DIPEAT_GEMINI_API_KEY", "GEMINI_API_KEY")` 를 쓰므로
**필드 이름으로는 값이 안 들어간다.** `extra="ignore"` 가 그 인자를 조용히 삼키고 필드는 기본값 `""` 로 남는다
→ `GeminiService.__init__` 이 `RuntimeError`.
지금 로컬에서 통과하는 건 개발자 셸에 `GEMINI_API_KEY` 가 export 돼 있기 때문이다. **깨끗한 CI 체크아웃에서는 깨진다.**

⚠️ **`DIPEAT_GEMINI_API_KEY` 로 주면 안 된다** — `test_config.py::test_prefixed_name_also_works` 가 깨진다.
반드시 **접두사 없는 `GEMINI_API_KEY`** 로 준다.

네트워크는 타지 않는다(`ASGITransport` 가 lifespan 을 안 돌리고 `conftest.py:153` 이 `FakeGemini` 를 주입).
그래서 **진짜 키가 아니라 아무 문자열이면 된다 → 배포 경로에 GitHub Secret 이 0개다.**

### 7.2 ruff 는 `uv run` 이 아니라 `uvx` — 그리고 지금 켜면 13건이 터진다

`pyproject.toml` 에 `[tool.ruff]` 설정은 있지만 **`uv.lock` 에 ruff 가 없다.**
`uv run ruff` → `Failed to spawn: ruff`. `uvx ruff` 를 써야 한다.

⚠️ **현재 코드베이스에 `uvx ruff check .` 를 돌리면 13건(11건 자동수정 가능)이 나온다** — 대부분 import 정렬.
그래서 아래 `api-ci.yml` 의 ruff 스텝은 `continue-on-error: true` 로 두었다.
**차단 게이트로 승격하려면 먼저 한 번 정리해야 한다:**

```bash
cd api && uvx ruff check --fix . && uvx ruff check .
```

정리한 뒤 `continue-on-error` 줄을 지운다.

### 7.2b ⚠️ 액션 버전 — `setup-uv` 만 규칙이 다르다

아래 워크플로의 액션 버전은 작성 시점에 실제 태그를 조회해 확인한 값이다.

| 액션 | 쓰는 값 | 비고 |
|---|---|---|
| `actions/checkout` | `@v7` | 이동 태그 있음 |
| `actions/setup-node` | `@v7` | 이동 태그 있음 |
| `google-github-actions/auth` | `@v3` | 이동 태그 있음 |
| `google-github-actions/setup-gcloud` | `@v3` | 이동 태그 있음 |
| `astral-sh/setup-uv` | **`@v9.0.0`** | ⚠️ **이동 태그가 `v7` 에서 멈춰 있다.** 최신 릴리스는 `v9.0.0` 인데 `v8`·`v9` 이동 태그가 없어서 `@v9` 는 해석되지 않는다 → **전체 버전으로 박아야 한다** |

확인 명령(버전을 올릴 때 다시 돌릴 것):

```bash
gh api repos/astral-sh/setup-uv/git/matching-refs/tags/v \
  --jq '[.[].ref|sub("refs/tags/";"")]|map(select(test("^v[0-9]+$")))|join(" ")'
```

### 7.3 `probe_models.py` 는 매 푸시가 아니라 매일

세 가지 이유:

1. ⚠️ **게이트가 아니다.** 설정된 모델이 죽어 있으면 `⚠️` 를 출력하고도 `return 0` 한다(`scripts/probe_models.py:59-60`).
   AGENTS.md 는 "배포 전 필수"라고 하지만 실제로는 아무것도 막지 않는다 → 출력에서 `⚠️` 를 grep 해 강제 실패시킨다.
2. **커밋 이벤트가 아니라 시간 이벤트다.** 모델이 죽는 건 CSS 를 고쳐서가 아니다. 잘못된 축에 붙이는 것.
3. **업스트림 일시 503 하나가 무관한 배포를 막는다.**

대신 배포 파이프라인에는 **태그 리비전에 실제 `POST /api/v1/chat` 스모크**를 건다.
텍스트 전용이라 ~1초에 1원 미만인데, **실배포본에서 시크릿·1차 모델·라우팅을 한 번에** 검증한다.
`probe_models.py` 보다 강한 확인이다.

### 7.4 `web-ci.yml`

```yaml
name: web-ci
on:
  pull_request:
    paths: ['web/**', '.github/workflows/web-ci.yml']

concurrency:
  group: web-ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  check:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: web
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: '22.22.0'          # 로컬과 동일
          cache: npm
          cache-dependency-path: web/package-lock.json
      - run: npm ci
      - run: npm run lint
      # 진짜 게이트는 이것 — oxlint 는 타입을 보지 않는다. tsc -b 가 본다.
      # Vercel 빌드와 중복이 아니다: Vercel 은 실패해도 '배포만' 막고 PR 은 초록으로 남는다.
      - run: npm run build
```

### 7.5 `api-ci.yml`

```yaml
name: api-ci
on:
  pull_request:
    paths: ['api/**', '.github/workflows/api-ci.yml']

concurrency:
  group: api-ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  test:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: api
    env:
      # ⚠️ 진짜 키가 아니다. 테스트는 네트워크를 타지 않는다(FakeGemini 주입).
      #    다만 GeminiService.__init__ 이 빈 키를 거부하므로 비어 있으면 16개가 깨진다.
      #    ⚠️ 반드시 접두사 없는 이름. DIPEAT_ 접두사로 주면 test_config 가 깨진다.
      GEMINI_API_KEY: ci-dummy-not-a-real-key
    steps:
      - uses: actions/checkout@v7
      - uses: astral-sh/setup-uv@v9.0.0   # ⚠️ 이동 태그 v9 는 없다 — 7.2 참고
        with:
          enable-cache: true
          cache-dependency-glob: api/uv.lock
      - run: uv sync --locked
      # ruff 는 uv.lock 에 없다 → uv run 이 아니라 uvx.
      # ⚠️ 현재 13건이 남아 있어 일단 비차단. `uvx ruff check --fix .` 로 정리한 뒤 이 줄을 지운다.
      - run: uvx ruff check .
        continue-on-error: true
      - run: uv run pytest -q
```

### 7.6 `api-deploy.yml`

```yaml
name: api-deploy
on:
  push:
    branches: [main]
    paths: ['api/**', '.github/workflows/api-deploy.yml']
  workflow_dispatch:

concurrency:
  group: api-deploy          # 배포는 절대 병렬로 돌리지 않는다
  cancel-in-progress: false

env:
  PROJECT_ID: dip-eat
  PROJECT_NUMBER: '178327258666'
  REGION: asia-northeast3
  SERVICE: dipeat-api
  AR_REPO: dipeat

jobs:
  test:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: api } }
    env:
      GEMINI_API_KEY: ci-dummy-not-a-real-key
    steps:
      - uses: actions/checkout@v7
      - uses: astral-sh/setup-uv@v9.0.0   # ⚠️ 이동 태그 v9 는 없다 — 7.2 참고
        with: { enable-cache: true, cache-dependency-glob: api/uv.lock }
      - run: uv sync --locked
      - run: uv run pytest -q

  deploy:
    needs: test
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write        # ⚠️ 없으면 WIF 가 조용히 실패한다
    steps:
      - uses: actions/checkout@v7

      - id: auth
        uses: google-github-actions/auth@v3
        with:
          project_id: ${{ env.PROJECT_ID }}
          workload_identity_provider: projects/${{ env.PROJECT_NUMBER }}/locations/global/workloadIdentityPools/github/providers/dip-eat
          service_account: gh-deployer@${{ env.PROJECT_ID }}.iam.gserviceaccount.com

      - uses: google-github-actions/setup-gcloud@v3
      - run: gcloud auth configure-docker ${{ env.REGION }}-docker.pkg.dev --quiet

      - name: 빌드 & 푸시 (amd64 고정)
        env:
          IMG: ${{ env.REGION }}-docker.pkg.dev/${{ env.PROJECT_ID }}/${{ env.AR_REPO }}/${{ env.SERVICE }}
        run: |
          # 기본 docker 드라이버는 registry 캐시를 못 내보낸다 → container 드라이버.
          docker buildx create --use --driver docker-container --name dipeat || true
          docker buildx build \
            --platform linux/amd64 \
            --file api/Dockerfile \
            --tag "$IMG:${{ github.sha }}" --tag "$IMG:latest" \
            --cache-from type=registry,ref=$IMG:buildcache \
            --cache-to   type=registry,ref=$IMG:buildcache,mode=max \
            --push api

      - name: 트래픽 없이 배포 (candidate 태그)
        env:
          IMG: ${{ env.REGION }}-docker.pkg.dev/${{ env.PROJECT_ID }}/${{ env.AR_REPO }}/${{ env.SERVICE }}
        run: |
          gcloud run deploy "$SERVICE" \
            --image "$IMG:${{ github.sha }}" \
            --region "$REGION" \
            --no-traffic --tag candidate \
            --allow-unauthenticated \
            --service-account "dipeat-api-run@${PROJECT_ID}.iam.gserviceaccount.com" \
            --cpu 1 --memory 2Gi --cpu-boost \
            --concurrency 8 --max-instances 4 --min-instances 0 \
            --timeout 105 \
            --startup-probe httpGet.path=/api/v1/health,httpGet.port=8080,initialDelaySeconds=0,timeoutSeconds=3,periodSeconds=3,failureThreshold=10 \
            --set-secrets GEMINI_API_KEY=gemini-key:latest \
            --set-env-vars '^@^DIPEAT_GEMINI_MAX_ATTEMPTS=1@DIPEAT_MAX_UPLOAD_BYTES=2097152@DIPEAT_LOG_LEVEL=INFO'

      - name: 스모크 — 실배포본에서 시크릿·모델·라우팅 확인
        run: |
          # Cloud Run URL 은 결정적이다. describe 로 파싱할 필요가 없다.
          TAG_URL="https://candidate---${SERVICE}-${PROJECT_NUMBER}.${REGION}.run.app"

          # 1) 부팅 + 시크릿 주입
          curl -fsS --max-time 30 "$TAG_URL/api/v1/health" | tee /dev/stderr | jq -e '.has_api_key == true'

          # 2) 1차 모델이 이 키로 실제 응답하는지. 텍스트 전용 ~1초, 1원 미만.
          #    .model 까지 찍어두면 폴백으로 에스컬레이션했는지도 로그에 남는다.
          curl -fsS --max-time 60 -X POST "$TAG_URL/api/v1/chat" \
            -H 'content-type: application/json' \
            -d '{"text":"물 한 잔 주세요","source_lang":"ja","direction":"ko2local"}' \
          | tee /dev/stderr | jq -e '.translated | length > 0'

      - name: 스모크 통과 → 트래픽 전환
        run: gcloud run services update-traffic "$SERVICE" --region "$REGION" --to-latest

      - name: 실패 시 — candidate 는 트래픽 0 이므로 운영은 무사
        if: failure()
        run: echo "::warning::candidate 리비전이 스모크에서 떨어졌습니다. 운영 트래픽은 이전 리비전에 그대로 있습니다."
```

### 7.7 `contract-drift.yml`

AGENTS.md 의 "손으로 타입 쓰지 말 것" 규칙을 기계로 집행한다.

```yaml
name: contract-drift
on:
  pull_request:
    paths:
      - 'api/app/schemas/**'
      - 'api/app/api/**'
      - 'api/openapi.json'
      - 'web/src/types/api.gen.ts'

jobs:
  drift:
    runs-on: ubuntu-latest
    env:
      GEMINI_API_KEY: ci-dummy-not-a-real-key
    steps:
      - uses: actions/checkout@v7
      - uses: astral-sh/setup-uv@v9.0.0   # ⚠️ 이동 태그 v9 는 없다 — 7.2 참고
        with: { enable-cache: true, cache-dependency-glob: api/uv.lock }
      - uses: actions/setup-node@v7
        with: { node-version: '22.22.0' }

      - name: openapi.json 재생성 (AGENTS.md 와 동일한 명령)
        working-directory: api
        run: |
          uv sync --locked
          uv run python -c "import json;from app.main import create_app;open('openapi.json','w').write(json.dumps(create_app().openapi(),ensure_ascii=False,indent=2))"

      - name: api.gen.ts 재생성
        working-directory: web
        # ⚠️ package.json 의 gen:api 는 openapi-typescript@7 이라 마이너가 떠다닌다.
        #    떠다니면 코드를 안 고쳐도 어느 날 diff 가 나서 무관한 PR 을 막는다.
        #    `npx openapi-typescript@7 --version` 으로 현재 버전을 확인해 정확히 박을 것.
        run: npx -y openapi-typescript@7.9.1 ../api/openapi.json -o src/types/api.gen.ts

      - name: 커밋된 산출물과 비교
        run: |
          if ! git diff --exit-code -- api/openapi.json web/src/types/api.gen.ts; then
            echo "::error::스키마를 고치고 openapi.json / api.gen.ts 를 커밋하지 않았습니다."
            echo "로컬에서 AGENTS.md 의 '스키마를 바꿨으면' 두 줄을 실행하고 커밋하세요."
            exit 1
          fi
```

### 7.8 `probe-models.yml`

```yaml
name: probe-models
on:
  schedule: [{ cron: '0 0 * * *' }]     # 모델 사망은 커밋이 아니라 시간 이벤트다
  workflow_dispatch:

jobs:
  probe:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: api } }
    steps:
      - uses: actions/checkout@v7
      - uses: astral-sh/setup-uv@v9.0.0   # ⚠️ 이동 태그 v9 는 없다 — 7.2 참고
        with: { enable-cache: true, cache-dependency-glob: api/uv.lock }
      - run: uv sync --locked
      - name: 이 키로 실제 응답하는 모델 확인
        env:
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}   # ← 유일한 진짜 시크릿
        run: |
          # ⚠️ 이 스크립트는 모델이 죽어 있어도 exit 0 이다(⚠️ 만 출력).
          #    그래서 출력에서 직접 잡아 실패시킨다.
          uv run python scripts/probe_models.py | tee probe.log
          if grep -q '⚠️' probe.log; then
            echo "::error::1차/폴백 모델이 응답하지 않습니다. gemini-3.5-flash 때와 같은 상황입니다."
            exit 1
          fi
```

GitHub Secret 은 **`GEMINI_API_KEY` 단 하나**(이 워크플로 전용). 배포 경로에는 시크릿이 0개다.

---

## 8. 로컬에서 손으로 배포할 때

[3장](#3-첫-배포-순서--닭과-달걀은-없다) 5번 단계. 자동화 전에 사람이 한 번 성공시켜야 한다.

**여기가 이미지가 처음 생기는 곳이다.** 저장소가 비어 있는 상태에서 [5장](#5-cloud-run-설정값--왜-이-숫자인가)의
`--image ...:latest` 를 먼저 치면 `Image ... not found` 로 죽는다. 순서는 **빌드·푸시 → 배포**다.

```bash
IMG="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/${SERVICE}"
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

# ⚠️⚠️ --platform linux/amd64 를 빼지 마라.
# :latest 도 같이 달아둔다 — 5장 참조 명령이 :latest 를 가리키기 때문.
# (에뮬레이션이라 arm64 맥에서 첫 빌드는 몇 분 걸린다.)
docker buildx build --platform linux/amd64 -f api/Dockerfile \
  -t "$IMG:bootstrap" -t "$IMG:latest" --push api

gcloud run deploy "$SERVICE" --image "$IMG:bootstrap" --region "$REGION" \
  --allow-unauthenticated \
  --service-account "dipeat-api-run@${PROJECT_ID}.iam.gserviceaccount.com" \
  --cpu 1 --memory 2Gi --cpu-boost \
  --concurrency 8 --max-instances 4 --min-instances 0 --timeout 105 \
  --startup-probe httpGet.path=/api/v1/health,httpGet.port=8080,initialDelaySeconds=0,timeoutSeconds=3,periodSeconds=3,failureThreshold=10 \
  --set-secrets GEMINI_API_KEY=gemini-key:latest \
  --set-env-vars '^@^DIPEAT_GEMINI_MAX_ATTEMPTS=1@DIPEAT_MAX_UPLOAD_BYTES=2097152@DIPEAT_LOG_LEVEL=INFO'

curl -s "https://${SERVICE}-${PROJECT_NUMBER}.${REGION}.run.app/api/v1/health" | jq
# → {"status":"ok","model":"gemini-3.1-flash-lite","has_api_key":true}
```

> ⚠️⚠️ **애플 실리콘에서 그냥 `docker build` 하면 arm64 이미지가 나온다. Cloud Run 은 linux/amd64 만 돈다.**
> 증상은 로그에 `Container failed to start` 한 줄뿐이라 Dockerfile 을 의심하며 한나절을 태운다.
> `--platform linux/amd64` 는 선택이 아니다.

> ⚠️ `api/Dockerfile` 은 BuildKit 전용 문법(`--mount=type=cache`, `--mount=type=bind`)을 쓴다.
> `docker buildx` 를 쓰면 문제없지만, 아주 오래된 도커 데몬의 `docker build` 로는 실패한다.

### 8.1 로컬에 도커가 없다면 — `--source` (⚠️ 이 Dockerfile 에서는 실패할 수 있다)

README 가 쓰던 방식이다. **로컬 도커가 있으면 [8장](#8-로컬에서-손으로-배포할-때)의 buildx 를 쓰는 게 확실하다.**

> ⚠️ **`api/Dockerfile` 은 BuildKit 전용 문법(`RUN --mount=type=cache`, `--mount=type=bind`)을 쓴다.**
> Cloud Build 의 기본 docker 빌더는 BuildKit 이 켜져 있지 않을 수 있고, 그러면
> `the --mount option requires BuildKit` 으로 죽는다.
> `docker buildx` 는 그 자체가 BuildKit 이라 이 문제가 없다 — **그래서 buildx 가 1순위다.**
> 아래는 도커를 못 쓸 때의 차선책이고, 실패하면 Dockerfile 의 `--mount` 두 줄을 걷어내야 한다.

```bash
gcloud run deploy "$SERVICE" --source ./api --region "$REGION" \
  --allow-unauthenticated \
  --service-account "dipeat-api-run@${PROJECT_ID}.iam.gserviceaccount.com" \
  --cpu 1 --memory 2Gi --cpu-boost \
  --concurrency 8 --max-instances 4 --min-instances 0 --timeout 105 \
  --set-secrets GEMINI_API_KEY=gemini-key:latest \
  --set-env-vars '^@^DIPEAT_GEMINI_MAX_ATTEMPTS=1@DIPEAT_MAX_UPLOAD_BYTES=2097152@DIPEAT_LOG_LEVEL=INFO'
```

`api/` 에 `Dockerfile` 이 있으므로 Cloud Build 가 **빌드팩이 아니라 그 Dockerfile 을** 쓴다
(빌드팩 경로였다면 `Dockerfile` 헤더 주석이 경고하는 gunicorn/WSGI 문제가 터진다).

**장점: Cloud Build 는 amd64 머신에서 도므로 [8장](#8-로컬에서-손으로-배포할-때)의 arm64 함정이 원천적으로 없다.**
로컬 도커도 필요 없다. (다만 위의 BuildKit 문제가 그 장점을 상쇄할 수 있다.)

**단점**: 매번 소스를 업로드하고, 이미지 태그가 `github.sha` 로 안 남아 **어느 커밋이 배포됐는지 추적이 흐려진다.**
그래서 CI([7.6](#76-api-deployyml))는 명시적 빌드 + 다이제스트 배포를 쓴다. `--source` 는 부트스트랩용이다.

---

## 9. 발표 당일 체크리스트

**T-1일**

```bash
cd api && uv run python scripts/probe_models.py     # 1차·폴백 모델 생존 확인
cd api && GEMINI_API_KEY=ci-dummy uv run pytest -q  # 57 passed
```
- 실기기(iOS Safari)에서 PWA 설치 + 마이크 권한 + 실제 스캔 1회. **헤드리스로는 검증 불가다.**

**T-1시간** — 콜드스타트(~3초) 제거

```bash
gcloud run services update dipeat-api --region asia-northeast3 --min-instances=1
curl -s "https://dipeat-api-${PROJECT_NUMBER}.asia-northeast3.run.app/api/v1/health"
```

**발표 중** — 실패 시 원인 순서: ① 모델 503 → ② 사진이 너무 큼/어두움 → ③ 네트워크. 로그는
`gcloud run services logs tail dipeat-api --region asia-northeast3`.

**끝난 즉시** ⚠️ **이걸 잊는 게 이 프로젝트의 1번 청구서 리스크다**

```bash
gcloud run services update dipeat-api --region asia-northeast3 --min-instances=0
```

1 vCPU + 2GiB 상시는 시간당 약 $0.09(₩125). 하루 ₩3,000, **한 달 방치하면 ₩90,000** —
MVP 전체 Gemini 비용의 20배다. **캘린더에 알림을 걸어라.**

---

## 10. 비용

₩1,400/USD. 스캔 1회 = 입력 ~1,900 / 출력 ~5,000 토큰, 평균 16초 기준.

| 모델 | 입력/1M | 출력/1M | 스캔 1회 |
|---|---|---|---|
| `gemini-3.1-flash-lite` (1차) | $0.25 | $1.50 | **$0.0080** (₩11) |
| `gemini-3.6-flash` (폴백) | $1.50 | $7.50 | **$0.0404** (₩57) |

**폴백은 1차의 5배다.** 에스컬레이션은 반올림 오차가 아니다.

### (a) 데모/MVP — 월 200 스캔 · 1,000 상세 · 300 음성

| 항목 | 금액 |
|---|---|
| Gemini 1차 스캔 200 | $1.60 |
| Gemini 폴백 20 (10%) | $0.81 |
| Gemini 상세 1,000 + 음성 300 | $0.68 |
| **Gemini 소계** | **$3.09** (₩4,300) |
| Cloud Run | ~$0.04 |
| Artifact Registry | ~$0.05 |
| Vercel Hobby | $0 |
| **합계** | **≈ $3.2 / 월** — **96%가 Gemini** |

### (b) 실서비스 — 월 10,000 스캔 · 50,000 상세 · 15,000 음성

| 항목 | 금액 |
|---|---|
| Gemini 1차 스캔 10,000 | $80 |
| Gemini 폴백 1,000 (10%) | $40 — **전체의 23%가 실패 재시도** |
| Gemini 상세 50,000 + 음성 15,000 | $34 |
| **Gemini 소계** | **$154** (₩216,000) |
| Cloud Run (160,000 vCPU-초 — 무료 한도 180,000 직전) | ~$2.4 |
| **Vercel Pro** (Hobby 는 비상업용 ToS) | **$20** |
| **합계** | **≈ $177 / 월** — **87%가 Gemini** |

**무료 티어는 vCPU 가 먼저 묶인다: 180,000 ÷ 16초 = 월 약 11,250 스캔.**
(⚠️ Tier 2 리전 적용 방식은 [1장](#-기존-근거-중-틀린-것-두-개) 참고 — 첫 달 실청구로 확인할 것.)

### 첫 진짜 청구서는 어디서 오나 — 위험 순

1. **발표 후 `--min-instances=1` 방치.** 트래픽 0에 월 ~₩90,000. MVP 전체 Gemini 비용의 20배. **압도적 1위다.**
2. **인증·rate limit 없는 공개 엔드포인트 남용.** 1 req/s 를 하루 유지하면 86,400 스캔 × $0.008 = **하루 $691**.
   `--max-instances 4` 가 유일한 집행 장치이고, 그것도 상한을 $58/시간으로 낮출 뿐이다.
3. **Gemini 무료 티어 → 유료 전환이 조용히 일어난다.** 프로젝트에 결제를 붙이는 순간 호출이 과금으로 바뀐다.
   ⚠️ 그리고 **무료 티어 키는 데이터가 모델 개선에 쓰인다.** 우리가 보내는 건 실제 식당 메뉴판 사진이다.
   데모는 괜찮지만 "실서비스"라면 유료 전환이 비용이 아니라 **요건**이다.
4. Vercel 은 MVP 규모에서 한도(100GB 전송 / 10GB origin 전송) 근처에도 못 간다.
   청구서를 만드는 건 **오직 ToS 때문에 Pro 로 옮길 때**다.

---

## 11. README·AGENTS 에서 직접 고칠 것

이 문서를 반영하면서 같이 정리한다.

| 위치 | 현재 | 고칠 내용 |
|---|---|---|
| `README.md` 배포 섹션(164~206) | 40줄 런북 | **이 문서로 포인터** + 발표 당일 토글 2줄만 남긴다. 새벽 3시에 필요한 건 그 두 줄뿐이다 |
| `README.md:173` | `--timeout 120` | **`--timeout 105`** (120은 Vercel 과 동률) |
| `README.md:169-174` | `--concurrency` 없음, `--memory 1Gi` | `--concurrency 8`, `--memory 2Gi`, `--max-instances 4`, `--service-account`, `--startup-probe` 추가 |
| `README.md:200` | `--min-instances=1` 시간당 $0.08 | 2GiB 기준 **약 $0.09** |
| `README.md:153`, `AGENTS.md:11` | "55개" | **57개** |
| `README.md:111` | "실기기 PWA 검증은 Vercel 프리뷰 URL로" | ⚠️ Vercel **Standard Protection 이 기본 ON** 이라 프리뷰 URL 은 로그인을 요구한다. Hobby 는 공유 링크 1개 / 외부 사용자 1명 제한 — 그대로는 안 된다 |
| `AGENTS.md` "Gemini" 절 | — | `probe_models.py` 가 **모델이 죽어도 exit 0** 이라는 사실을 명시 |

---

## 12. 알면서 남겨둔 것

발표에는 문제없지만 실서비스 전에 닫아야 하는 것들. **모르는 게 아니라 고르지 않은 것이다.**

- **공개 경로에 인증도 rate limit 도 없다.** `--max-instances` 가 유일한 상한.
  Cloud Run ingress 를 Vercel 로 좁힐 수도 없다(Vercel 은 Hobby 에서 고정 egress IP 를 안 준다).
- **60MP 디코드는 설정으로 못 막는다.** `DIPEAT_MAX_UPLOAD_BYTES=2097152` 는 난이도를 올릴 뿐이다.
  진짜 해결은 코드: `Image.draft()` 로 JPEG 를 축소 디코드하거나 `MAX_IMAGE_PIXELS` 를 8MP 로 내린다.
- **`uvx ruff check .` 13건이 남아 있어** ruff 가 아직 차단 게이트가 아니다([7.2](#72-ruff-는-uv-run-이-아니라-uvx--그리고-지금-켜면-13건이-터진다)).
- **`fastapi[standard]` 가 `fastapi-cloud-cli` + `sentry-sdk` 를 운영 이미지에 끌고 온다.**
  컨테이너는 `uvicorn` 을 직접 실행하므로 런타임에 안 쓴다. 정리하면 이미지가 3~4MB 줄고
  아무도 요청하지 않은 공급망 표면이 사라진다. ⚠️ 단 `python-multipart` 는 현재 이 extra 로만 들어오므로
  **명시적으로 남겨야 한다** — 파일 업로드가 핵심 기능이다.
- **`tenacity` 가 선언만 되고 import 되지 않는다**(재시도는 `gemini.py` 에 직접 구현돼 있다).
- **PR 프리뷰가 운영 백엔드를 공유한다.** `vercel.json` 리라이트 목적지에 환경변수를 못 쓰기 때문이다.
  → 프리뷰에서 실제 스캔을 하면 **운영 Gemini 비용이 나간다.**
  분리하려면 프런트에 `VITE_API_BASE` 탈출구(절대 URL + CORS 경로)를 만들고 스테이징 Cloud Run 서비스를 띄워야 한다.
- **테스트가 `GEMINI_API_KEY` 환경변수에 우발적으로 의존한다**([7.1](#71-57개-테스트에는-더미-키가-필요하다)).
  `Settings(gemini_api_key=...)` 가 alias 때문에 안 먹는 것을 고치면 더미 키도 필요 없어진다.

---

## 부록 A. 스트리밍 통과 검증 (`/api/v1/_probe/stream`)

> 임시 진단 장치다. 결론이 나면 `api/app/api/routes/probe.py`,
> `api/tests/test_probe_stream.py`, `main.py` 의 라우터 등록 한 줄, 그리고 이 부록을 함께 지운다.

### 왜 재는가

메뉴 스캔 지연은 거의 전부 **출력 토큰**에서 나온다. 실측(58개 항목):

| | |
|---|---|
| 출력 토큰 | 9,243 |
| 생성 시간 | 34.5초 |
| 생성 속도 | **약 268 tok/s** |
| 항목당 | 약 159 토큰 |

항목이 JSON 배열에 **순서대로** 완성되므로, 스트리밍하면 첫 항목은
앞부분(~30토큰) + 159토큰 ≈ 190토큰에서 완성된다 → **약 0.7초**.
34.5초 스피너가 0.7초 첫 카드로 바뀐다. 총 시간은 그대로지만 체감이 완전히 달라진다.

**단, Vercel 리라이트 프록시가 청크를 그대로 흘려보낼 때만 성립한다.**
프록시가 응답을 다 모았다가 뱉으면 백엔드가 아무리 스트리밍해도 브라우저는 34초 뒤에 통째로 받는다.
프록시 계층의 스트리밍 버퍼링은 실제로 흔하다. 그래서 **구현 전에** 경로부터 검증한다.

### 재기 전에 — ⚠️ 머지는 배포가 아니다

**CI/CD 를 붙이기 전까지 `main` 머지만으로는 Cloud Run 이 바뀌지 않는다.**
이미지를 다시 빌드해 푸시하고 배포해야 한다. 이걸 잊으면 새 엔드포인트가 **404** 로 나오고,
"코드가 잘못됐나" 를 한참 뒤진다(실제로 한 번 당했다).

```bash
# 레포 루트에서 — main 을 먼저 받아온다
git checkout main && git pull

docker buildx build --platform linux/amd64 -f api/Dockerfile \
  -t asia-northeast3-docker.pkg.dev/dip-eat/dipeat/dipeat-api:latest --push api

gcloud run deploy dipeat-api \
  --image asia-northeast3-docker.pkg.dev/dip-eat/dipeat/dipeat-api:latest \
  --region asia-northeast3

# 배포 확인 — 404 면 아직 옛 리비전이다
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://dipeat-api-178327258666.asia-northeast3.run.app/api/v1/_probe/stream?chunks=2&delay_ms=0"
```

> `gcloud run deploy` 에 `--image` 와 `--region` 만 주면 나머지 설정(동시성·타임아웃·시크릿·
> 환경변수·서비스 계정)은 **이전 리비전에서 그대로 승계**된다. 매번 전체 플래그를 다시 칠 필요 없다.

### 어떻게 재는가

`--no-buffer` 와 `-w` 로 **각 줄의 도착 시각**을 찍는다. 백엔드 직결과 Vercel 경유를 비교하는 게 핵심이다.

```bash
# ① 백엔드 직결 — 기준선
curl -N -s "https://dipeat-api-178327258666.asia-northeast3.run.app/api/v1/_probe/stream?chunks=10&delay_ms=500" \
  | perl -MTime::HiRes=time -ne 'BEGIN{$t=time; $|=1} printf "  +%5.2fs  %s", time-$t, $_'

# ② Vercel 경유 — 이게 진짜 시험
curl -N -s "https://dip-eat.vercel.app/api/v1/_probe/stream?chunks=10&delay_ms=500" \
  | perl -MTime::HiRes=time -ne 'BEGIN{$t=time; $|=1} printf "  +%5.2fs  %s", time-$t, $_'
```

`perl` 은 macOS 에 기본 탑재라 설치가 필요 없다.
⚠️ `ts`(moreutils)나 `date +%3N` 은 macOS 기본에 **없다** — `command not found` 를 본다면 그 이유다.
⚠️ `$|=1` 을 빼지 말 것. perl 이 출력을 버퍼링하면 우리가 재려던 바로 그 현상을 우리가 만들어낸다.

정상이면 이렇게 나온다:

```
  + 0.05s  {"i":0,"server_elapsed_ms":0,"last":false}
  + 0.55s  {"i":1,"server_elapsed_ms":501,"last":false}
  + 1.05s  {"i":2,"server_elapsed_ms":1002,"last":false}
  ...
```

### 어떻게 읽는가

| 관찰 | 해석 | 다음 |
|---|---|---|
| 두 경우 모두 0.5초 간격으로 한 줄씩 | ✅ 경로가 스트리밍을 통과한다 | 스트리밍 구현 진행 |
| ①은 한 줄씩, **②만 끝에 몰림** | ❌ **Vercel 프록시가 버퍼링**한다 | 아래 완화책 → 그래도 안 되면 설계 변경 |
| ①도 몰림 | 백엔드/Cloud Run 문제 | `X-Accel-Buffering` 은 이미 붙어 있다. Cloud Run 설정을 본다 |

각 줄의 `server_elapsed_ms` 가 `0, 500, 1000...` 으로 정상인데 도착만 몰렸다면,
**백엔드는 제때 뱉었고 중간이 범인**이라는 확정 증거다. 이게 이 필드를 넣은 이유다.

### ②만 막혔을 때

1. **최소 버퍼 임계값 가설** — 프록시가 일정 바이트가 쌓여야 흘리는 경우가 있다. 패딩을 키워 확인:
   ```bash
   curl -N -s "https://dip-eat.vercel.app/api/v1/_probe/stream?chunks=10&delay_ms=500&pad_bytes=4096" \
     | perl -MTime::HiRes=time -ne 'BEGIN{$t=time; $|=1} printf "  +%5.2fs  %s", time-$t, $_'
   ```
   이걸로 뚫리면 원인은 경로가 아니라 임계값이다(실용적 완화책이 된다).
2. **그래도 막히면 설계를 바꾼다** — 프런트가 Cloud Run 을 직접 호출한다.
   `VITE_API_BASE` 를 추가하고 `DIPEAT_CORS_ORIGINS` 에 Vercel 도메인을 넣는 경로다
   ([12장](#12-알면서-남겨둔-것)에 "탈출구"로 적어둔 그 구조). 스캔만 직결하고 나머지는 리라이트로 둬도 된다.

### 안전장치

인증 없는 공개 엔드포인트라 상한을 걸어뒀다(초과 시 422):
`chunks` ≤ 30, `delay_ms` ≤ 1,000, `pad_bytes` ≤ 8,192 → **최악 30초**.
`--timeout 105` 와 `--concurrency 8` 에 여유가 있다. Gemini 를 부르지 않으므로 **비용은 0**이다.

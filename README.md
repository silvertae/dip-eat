# 찍먹 (dipeat)

[찍먹 열기](https://dip-eat.vercel.app)

찍먹은 해외 식당에서 메뉴판을 찍으면 메뉴를 읽고, 주문하고, 점원과 대화할 수 있게 돕는 모바일 웹 앱입니다. 메뉴에 적힌 원문은 그대로 두고, 한국어 설명·가격 환산·AI가 추정한 알레르기 정보를 덧붙입니다.

찍먹은 설치형 PWA로도 쓸 수 있습니다. 다만 알레르기 정보와 메뉴 해석에는 AI의 추정이 포함될 수 있으므로, 알레르기가 있거나 확신이 들지 않을 때는 반드시 점원에게 확인해 주세요.

## 사용 방법

1. 모바일에서 [찍먹](https://dip-eat.vercel.app)을 엽니다.
2. 필요하면 알레르기, 피하고 싶은 식재료, 예산을 설정합니다.
3. 메뉴판을 촬영하거나 사진을 선택합니다.
4. 읽어 낸 메뉴 카드에서 원문, 간단한 설명, 가격, AI 알레르기 추정을 확인합니다.
5. 담은 메뉴는 주문 카드로 바로 보여 주고, 대화 화면에서는 점원과 주고받을 말을 준비합니다.

앱을 설치하면 한 번 스캔한 식당은 최근 목록에서 다시 볼 수 있습니다. 새 메뉴를 읽거나 음성 대화를 이용할 때는 인터넷 연결이 필요합니다.

## 직접 실행하기

로컬에서 실행하려면 Python 3.13, [uv](https://docs.astral.sh/uv/), Node.js 22가 필요합니다. 메뉴 스캔과 대화 기능에는 Google AI Studio에서 발급한 Gemini API 키도 필요합니다.

```bash
git clone https://github.com/silvertae/dip-eat.git
cd dip-eat

cp api/.env.example api/.env
# api/.env의 GEMINI_API_KEY에 발급받은 키를 입력합니다.
```

저장소 루트에서 터미널 두 개를 열고 각각 실행합니다.

```bash
# 터미널 1: API
cd api
uv sync
uv run uvicorn app.main:app --reload --reload-include '*.md' --port 8000
```

```bash
# 터미널 2: 웹 앱
cd web
npm ci
npm run dev
```

브라우저에서 `http://localhost:5173`을 열면 됩니다. 로컬 웹 앱은 `/api` 요청을 실행 중인 API 서버로 전달합니다.

## 기여하기

버그 수정, 사용성 개선, 메뉴판 인식 품질 개선을 위한 기여를 환영합니다.

1. 저장소를 포크하고 작업 브랜치를 만듭니다.
2. 변경 범위를 작게 유지하고, 사용자에게 보이는 동작을 PR에 설명합니다.
3. 관련 검사를 실행한 뒤 PR을 엽니다.

```bash
cd api && GEMINI_API_KEY=ci-dummy uv run pytest
cd web && npm run lint && npm test && npm run build
```

API 키나 개인 사진을 커밋하지 마세요. 메뉴 인식이나 알레르기 표시를 바꾼 경우에는, 실제 메뉴판에서 사용자가 어떻게 보게 되는지도 함께 확인해 주세요.

## 프로젝트 구조

```text
api/       FastAPI 기반 메뉴 인식·설명·대화 API
web/       React 기반 모바일 웹 앱과 PWA
docs/      참고 문서
samples/   로컬에서 쓰는 메뉴판 샘플 자리
```

## 핵심 기술

- **웹 앱**: React, TypeScript, Vite, Tailwind CSS, Zustand, IndexedDB, PWA
- **API**: Python, FastAPI, Pydantic, Pillow
- **AI**: Google GenAI(Gemini)를 이용한 메뉴판 인식, 설명, 번역
- **배포**: Vercel의 웹 앱과 Google Cloud Run의 API

## 아키텍처

```text
모바일 브라우저 · PWA
        │ 사진 촬영, 세션·최근 스캔 저장
        ▼
Vercel의 React 웹 앱
        │ /api 요청 전달
        ▼
Cloud Run의 FastAPI
        │ 메뉴판 인식·설명·대화 요청
        ▼
Gemini
```

메뉴판 스캔은 완료된 항목부터 화면에 보여 줍니다. 상세 설명은 사용자가 카드를 열었을 때 따로 요청해, 처음 결과를 볼 때까지 기다리는 시간을 줄였습니다.

## 로드맵

- iOS Safari에서 PWA 설치, 마이크 권한, 실제 휴대폰 촬영 메뉴판을 검증합니다.
- 주문 뒤의 마무리 경험을 정리해 주문 흐름을 자연스럽게 완성합니다.
- 실제 메뉴판에서 발견되는 인식 오류와 불확실한 알레르기 안내를 계속 개선합니다.

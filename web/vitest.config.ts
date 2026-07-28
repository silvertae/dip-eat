import { defineConfig } from 'vitest/config'

/** ⚠️ vitest 는 `vitest.config` 를 찾으면 `vite.config` 를 **아예 읽지 않는다**(병합이 아니다).
 *  그게 이 파일이 따로 있는 이유다:
 *   - 테스트에 PWA(workbox 매니페스트 생성)·tailwind·react 플러그인을 돌릴 이유가 없다.
 *   - 반대 방향이 더 중요하다 — `vite.config.ts` 에 `test:` 를 넣으면 **프로덕션 빌드 설정이
 *     dev 전용 패키지(`vitest/config`)를 import** 하게 된다. Vercel 빌드 경로에 끼울 일이 아니다.
 *  잃는 건 없다: 경로 alias 가 없고(전부 상대경로), `/api` 프록시는 dev 서버 전용,
 *  테스트 그래프에 CSS/JSX 가 없다.
 */
export default defineConfig({
  test: {
    // 브라우저 DOM 이 필요한 코드가 테스트 대상에 없다. 근거는 src/test/setup.ts 주석 참고.
    // 컴포넌트 테스트가 필요해지면 그 파일에만 `@vitest-environment happy-dom` docblock 을 단다.
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/test/setup.ts'],
    // vitest 5 에서 기본값이 되는 동작을 지금 명시한다(테스트마다 목 호출기록 초기화).
    clearMocks: true,
    // vi.stubGlobal('fetch', …) 을 테스트 끝에 자동 복원.
    unstubGlobals: true,
  },
})

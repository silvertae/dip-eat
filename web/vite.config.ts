import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// 개발 서버의 /api 프록시는 프로덕션의 Vercel rewrites 와 같은 모양이다.
// 덕분에 개발·프로덕션 모두 동일 출처가 되어 CORS 를 아예 만나지 않는다.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // 'prompt': 새 버전이 있어도 자동 리로드하지 않는다. 업로드/녹음 중 강제 리로드로
      // 작업이 날아가는 걸 막으려면 사용자에게 물어봐야 한다(main.tsx 에서 처리).
      registerType: 'prompt',
      // 매니페스트에 안 들어가지만 프리캐시하고 싶은 정적 자산.
      includeAssets: ['favicon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: '찍먹 — 메뉴판 번역',
        short_name: '찍먹',
        description: '해외 식당 메뉴판을 사진 한 장으로 해석·주문·점원 대화까지.',
        lang: 'ko',
        theme_color: '#ea5a34',
        background_color: '#fff9f2',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          // 안드로이드 적응형 아이콘용. 콘텐츠가 안전영역 안에 있어 'any' 로도 쓴다.
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // SPA: 오프라인에서 어떤 경로로 들어와도 앱 셸을 띄운다. 단 /api 는 폴백 금지(백엔드 호출).
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // 참고 이미지 메타데이터 검색(커먼즈 API). origin=* CORS 라 status 200.
            urlPattern: /^https:\/\/commons\.wikimedia\.org\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'wikimedia-commons-api',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // 실제 썸네일 이미지 바이트. <img crossOrigin="anonymous"> 로 불러 CORS 응답(status 200)이다.
            // ⚠️⚠️ `statuses` 에 0(opaque)을 다시 넣지 말 것. opaque 를 캐시하면 크롬이 크기 유출을
            // 막으려고 항목마다 무작위 패딩을 quota 에 더한다 — 실측 24KB 썸네일이 장당 4.77MB(181배)로
            // 잡혀 92장이 441MB 가 됐다. expiration 은 항목 수만 세므로 이걸 절대 못 잡는다.
            // 캐시 이름의 -v2 는 그 시절 패딩된 캐시와 갈라놓기 위한 것이다(옛 캐시는 main.tsx 가 지운다).
            // handler 는 StaleWhileRevalidate 유지 — 이제 status 로 오류를 걸러내니 CacheFirst 도
            // 안전하지만, 그건 별건으로 잰 뒤에 바꾼다.
            urlPattern: /^https:\/\/upload\.wikimedia\.org\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'wikimedia-thumbs-v2',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // 환율. 최신 우선, 실패 시 캐시(₩ 는 하드코딩 폴백도 있어 절대 안 죽는다).
            urlPattern: /^https:\/\/open\.er-api\.com\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'fx-rates',
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      // 개발 중엔 SW 를 끈다(HMR 과 충돌·캐시 혼선 방지). 검증은 build + preview 로.
      devOptions: { enabled: false },
    }),
  ],
  server: {
    // 실기기 테스트: `npm run dev -- --host` + Android 는 Chrome DevTools 포트 포워딩,
    // iOS 는 mkcert 인증서를 프로파일로 설치할 것. 평문 http LAN 주소는 secure context 가
    // 아니라서 service worker 등록이 조용히 실패한다.
    proxy: {
      '/api': {
        target: process.env.VITE_API_ORIGIN ?? 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})

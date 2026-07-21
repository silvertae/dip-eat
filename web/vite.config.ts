import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 개발 서버의 /api 프록시는 프로덕션의 Vercel rewrites 와 같은 모양이다.
// 덕분에 개발·프로덕션 모두 동일 출처가 되어 CORS 를 아예 만나지 않는다.
export default defineConfig({
  plugins: [react(), tailwindcss()],
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

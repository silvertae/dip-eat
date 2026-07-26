import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'
import { useApp } from './store/app'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// persist 가 복원한 스캔이 있으면 완료 상태로 맞추고 미리보기 이미지를 IndexedDB 에서 되살린다.
// (렌더 밖에서 1회 호출 — StrictMode 이중 실행을 피하고, hydrate 는 자체 가드도 있다.)
void useApp.getState().hydrate()

// 저장소를 '영구' 로 승격 요청 — 브라우저가 용량 압박에 최근 식당·세션을 지우지 않게.
if (navigator.storage?.persist) void navigator.storage.persist().catch(() => {})

// opaque 로 캐시돼 장당 ~4.8MB 패딩이 붙어버린 옛 썸네일 캐시를 1회 폐기한다(실측 441MB).
// 스스로 줄지 않는다 — workbox 의 cleanupOutdatedCaches 는 precache 만 건드리고, 위 persist()
// 승격 탓에 브라우저의 자동 회수 대상도 아니다. 이름이 바뀐 새 캐시(-v2)가 CORS 로 다시 채운다.
// 배포 후 충분히 지나면(구버전 SW 가 다 갈리면) 이 줄은 지워도 된다.
// (`caches` 를 맨이름으로 쓰면 비보안 컨텍스트에서 ReferenceError — window 경유 + 옵셔널 체이닝.)
void window.caches?.delete('wikimedia-thumbs').catch(() => {})

// registerType 'prompt': 새 버전은 대기시켰다가 사용자가 수락할 때만 활성화한다.
const updateSW = registerSW({
  onNeedRefresh() {
    // 업로드·녹음 중 강제 리로드는 작업을 날린다 — 반드시 물어본다.
    if (window.confirm('찍먹 새 버전이 있어요. 지금 새로고침할까요?')) void updateSW(true)
  },
})

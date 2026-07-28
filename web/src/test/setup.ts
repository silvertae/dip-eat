import { beforeEach } from 'vitest'

/** 브라우저 Storage 의 최소 구현(메모리).
 *
 *  jsdom/happy-dom 을 깔지 않는 이유: node 22 는 ReadableStream·TextDecoder·FormData·Blob·
 *  File·AbortController·DOMException·URL.createObjectURL 을 전부 네이티브로 갖고 있다.
 *  오히려 node 쪽이 낫다 — DOM 에뮬레이터는 Blob/FormData 를 자체 구현으로 갈아끼우는데,
 *  NDJSON 청크 스윕 테스트가 노리는 게 정확히 그 경로다. 빠진 건 localStorage 하나뿐이고,
 *  그걸 얻자고 에뮬레이터를 통째로 까는 건 과하다.
 */
function createMemoryStorage() {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, String(v))
    },
    removeItem: (k: string) => {
      map.delete(k)
    },
    clear: () => {
      map.clear()
    },
  } as unknown as Storage
}

const storage = createMemoryStorage()

/** ⚠️ zustand persist 는 **모듈 로드 시점에** `window.localStorage` 를 읽는다
 *  (zustand/esm/middleware.mjs). 없으면 storage 를 못 잡고 (1) `set()` 마다 경고를 찍고
 *  (2) `useApp.persist` 자체를 만들지 않는다. setupFiles 는 테스트 파일의 import 보다 먼저
 *  실행되므로 여기가 유일하게 맞는 자리다.
 *
 *  `lib:["DOM"]` 이라 window/localStorage 는 이미 타입 선언돼 있다(런타임 값만 없다).
 *  그래서 직접 대입 대신 defineProperty 를 쓴다. 가짜 window 는 localStorage 만 갖는다 —
 *  테스트 그래프에 `typeof window` 로 브라우저를 감지하는 코드가 없다. */
Object.defineProperty(globalThis, 'localStorage', {
  value: storage,
  configurable: true,
  writable: true,
})
Object.defineProperty(globalThis, 'window', {
  value: { localStorage: storage },
  configurable: true,
  writable: true,
})

// store 의 'dipeat:session', fx 의 환율 캐시가 케이스 사이로 새지 않게 한다.
// (파일 사이는 vitest 의 isolate 가 막아주지만, 같은 파일 안은 아무도 안 막는다.)
beforeEach(() => {
  storage.clear()
})

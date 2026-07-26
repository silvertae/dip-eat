import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { resizeForUpload } from '../features/capture/resizeImage'
import { ApiError, chatTranslate, chatVoice, scanMenuStream } from '../lib/api'
import { getRecent, putRecent } from '../lib/db'
import type { CaptureMode, MenuItem, MenuScanResponse } from '../types/api'

/** 'scanning' = 첫 항목을 기다리는 중(화면은 로딩), 'streaming' = 항목이 들어오는 중(화면은 결과).
 *  둘을 나눠야 로딩 화면이 언제 결과 화면으로 넘어갈지 알 수 있다. */
type ScanPhase = 'idle' | 'resizing' | 'scanning' | 'streaming' | 'done' | 'error'

/** 같은 메뉴판에 같은 이름이 두 분류에 걸쳐 나올 수 있어 분류까지 묶어 키로 쓴다. */
export const itemKey = (item: MenuItem) => `${item.section} ${item.name_local}`

/** 대화 말풍선. me=내가 점원에게, them=점원이 나에게. */
export interface ChatBubble {
  from: 'me' | 'them'
  local: string
  ko: string
  reading?: string
}

interface AppState {
  captureMode: CaptureMode
  setCaptureMode: (mode: CaptureMode) => void

  /** 촬영본 미리보기 objectURL. 로딩 화면이 보여준다. */
  preview: string | null
  phase: ScanPhase
  scan: MenuScanResponse | null
  error: string | null

  /** itemKey → 수량. 새 메뉴판을 스캔하면 비운다(다른 식당이므로). */
  cart: Record<string, number>
  addToCart: (key: string) => void
  removeFromCart: (key: string) => void
  clearCart: () => void

  /** 점원 대화. 새 메뉴판을 스캔하면 비운다. */
  convo: ChatBubble[]
  /** 미리 번역된 말풍선을 그대로 넣는다(빠른 응답 칩 — 오프라인 가능). */
  pushBubble: (bubble: ChatBubble) => void
  /** 자유 발화를 /chat 으로 번역해 넣는다. 실패하면 에러 메시지를 던진다. */
  sendChat: (text: string, direction: 'ko2local' | 'local2ko', sourceLang: string) => Promise<void>
  /** 녹음 blob 을 /chat/voice 로 전사+번역해 넣는다. push-to-talk 가 부른다. */
  sendVoice: (
    audio: Blob,
    direction: 'ko2local' | 'local2ko',
    sourceLang: string,
  ) => Promise<void>

  /** 촬영 → 축소 → 스캔. 화면 이동은 호출부(로딩 화면)가 phase 를 보고 한다. */
  startScan: (file: File) => Promise<void>
  reset: () => void

  /** 부팅 시 1회. persist 가 복원한 스캔이 있으면 phase 를 done 으로 맞추고
   *  이미지 미리보기를 IndexedDB 에서 되살린다. StrictMode 이중 호출에도 안전. */
  hydrated: boolean
  hydrate: () => Promise<void>
  /** 홈의 "최근 식당" 을 탭했을 때. IndexedDB 에서 해당 스캔을 활성 세션으로 되살린다.
   *  기록이 사라졌으면(다른 탭이 정리) false — 호출부는 이때 화면을 이동하지 않는다. */
  openRecent: (scanId: string) => Promise<boolean>
}

export const useApp = create<AppState>()(
  persist(
    (set, get) => ({
  captureMode: 'poster',
  setCaptureMode: (mode) => set({ captureMode: mode }),

  preview: null,
  phase: 'idle',
  scan: null,
  error: null,
  hydrated: false,

  cart: {},
  addToCart: (key) =>
    set((s) => ({ cart: { ...s.cart, [key]: (s.cart[key] ?? 0) + 1 } })),
  removeFromCart: (key) =>
    set((s) => {
      const next = { ...s.cart }
      const qty = (next[key] ?? 0) - 1
      if (qty > 0) next[key] = qty
      else delete next[key]
      return { cart: next }
    }),
  clearCart: () => set({ cart: {} }),

  convo: [],
  pushBubble: (bubble) => set((s) => ({ convo: [...s.convo, bubble] })),
  async sendChat(text, direction, sourceLang) {
    const { translated, reading } = await chatTranslate({
      text,
      source_lang: sourceLang,
      direction,
    })
    // ko2local: 내가 한 말(한국어=text, 현지어=번역). local2ko: 점원 말(현지어=text, 한국어=번역).
    const bubble: ChatBubble =
      direction === 'ko2local'
        ? { from: 'me', ko: text, local: translated, reading }
        : { from: 'them', local: text, ko: translated }
    set((s) => ({ convo: [...s.convo, bubble] }))
  },
  async sendVoice(audio, direction, sourceLang) {
    const { source_text, translated, reading } = await chatVoice(audio, {
      source_lang: sourceLang,
      direction,
    })
    // ko2local: 내 발화(한국어=source_text, 현지어=번역). local2ko: 점원 발화(현지어=source_text).
    const bubble: ChatBubble =
      direction === 'ko2local'
        ? { from: 'me', ko: source_text, local: translated, reading }
        : { from: 'them', local: source_text, ko: translated }
    set((s) => ({ convo: [...s.convo, bubble] }))
  },

  async startScan(file) {
    // 이전 촬영본의 objectURL 을 놓아준다(누수 방지).
    const previous = get().preview
    if (previous) URL.revokeObjectURL(previous)

    set({
      preview: URL.createObjectURL(file),
      phase: 'resizing',
      scan: null,
      error: null,
      cart: {}, // 다른 식당이므로 이전 장바구니는 버린다
      convo: [], // 대화도 새 식당에서 초기화
    })

    try {
      let resized
      try {
        resized = await resizeForUpload(file)
      } catch {
        // 브라우저가 못 디코드하는 형식(HEIC 변환 실패 등). 원문 영문 메시지를
        // 그대로 보여주면 안 된다 — 서버 에러와 같은 기준으로 한국어로 매핑한다.
        throw new Error('이 사진은 열 수 없는 형식이에요. 다른 사진으로 시도해주세요.')
      }

      set({ phase: 'scanning' })

      // 항목이 오는 대로 화면에 붙인다. 첫 항목이 ~2초에 오므로 24초 스피너가 사라진다.
      // meta 가 항상 먼저 오기 때문에 onItem 시점에 scan 은 반드시 존재한다.
      const tail = await scanMenuStream(resized.blob, {
        mode: get().captureMode,
        onMeta: (meta) =>
          set({
            phase: 'streaming',
            scan: {
              ...meta,
              items: [],
              warnings: [],
              // done 이 오기 전까지는 알 수 없다. 화면은 이 값을 쓰지 않는다.
              meta: { model: '', latency_ms: 0, image_px: '' },
            },
          }),
        onItem: (item) =>
          set((s) => (s.scan ? { scan: { ...s.scan, items: [...s.scan.items, item] } } : {})),
      })

      const scan = get().scan
      if (!scan) throw new Error('메뉴판을 읽지 못했어요. 다시 시도해주세요.')
      const complete = { ...scan, warnings: tail.warnings, meta: tail.meta }
      set({ scan: complete, phase: 'done' })
      // 최근 식당 재열람용으로 결과 + 축소본을 IndexedDB 에 남긴다.
      // ⚠️ 완성된 뒤에만 저장한다 — 스트리밍 도중 저장하면 반쪽짜리 스캔이 '최근 식당'에 남는다.
      // 저장 실패가 핵심 흐름(스캔 성공)을 막지 않도록 조용히 삼킨다.
      void putRecent(complete, resized.blob).catch(() => {})
    } catch (err) {
      const message =
        err instanceof ApiError || err instanceof Error
          ? err.message
          : '알 수 없는 오류가 발생했어요.'

      // 중간에 끊겼어도 이미 받은 항목은 유효하다(서버가 partial 로 알려준다).
      // 30개를 받아놓고 전부 버리는 건 사용자에게 최악이다 — 경고를 달고 살린다.
      const partial = get().scan
      if (partial && partial.items.length > 0) {
        set({
          phase: 'done',
          scan: { ...partial, warnings: [...partial.warnings, `${message} 일부만 표시해요.`] },
        })
        return
      }
      set({ phase: 'error', error: message })
    }
  },

  reset() {
    // 활성 세션만 비운다 — IndexedDB 의 "최근 식당" 기록은 남겨 재열람할 수 있게 한다.
    const previous = get().preview
    if (previous) URL.revokeObjectURL(previous)
    set({ preview: null, phase: 'idle', scan: null, error: null, cart: {}, convo: [] })
  },

  async hydrate() {
    if (get().hydrated) return
    set({ hydrated: true })
    const { scan, preview } = get()
    if (!scan) return
    // persist 는 phase 를 복원하지 않는다 — 스캔이 있으면 완료 상태로 둔다(가드가 '/'로 튕기지 않게).
    if (get().phase !== 'done') set({ phase: 'done' })
    if (preview) return
    // objectURL 은 리로드로 무효화됐다 — 저장해둔 Blob 으로 다시 만든다.
    const entry = await getRecent(scan.scan_id).catch(() => undefined)
    if (entry?.image && !get().preview) set({ preview: URL.createObjectURL(entry.image) })
  },

  async openRecent(scanId) {
    if (get().scan?.scan_id === scanId) return true // 이미 활성 세션 — 장바구니·대화 유지
    const entry = await getRecent(scanId).catch(() => undefined)
    if (!entry) return false // 기록이 사라짐(다른 탭이 정리 등) — 호출부가 이동을 취소한다
    const previous = get().preview
    if (previous) URL.revokeObjectURL(previous)
    set({
      scan: entry.scan,
      preview: entry.image ? URL.createObjectURL(entry.image) : null,
      phase: 'done',
      error: null,
      cart: {}, // 다시 여는 식당은 새로 담는다
      convo: [],
    })
    return true
  },
    }),
    {
      name: 'dipeat:session',
      version: 1,
      // 활성 세션만 저장한다. preview(objectURL)·phase·error·hydrated 는 리로드에 되살릴 수 없거나
      // 되살리면 안 되는 값이라 제외. 이미지 Blob 은 여기가 아니라 IndexedDB(lib/db) 에 있다.
      partialize: (s) => ({
        captureMode: s.captureMode,
        // ⚠️ 스트리밍 중에는 저장하지 않는다. persist 는 상태가 바뀔 때마다 쓰는데,
        // 항목마다 쓰면 90개짜리 메뉴판에서 '점점 커지는 JSON' 을 90번 직렬화하게 된다
        // (누적 1MB+). 모바일에서 눈에 띄게 버벅인다. done 에서 한 번만 쓰면 충분하고,
        // 도중에 앱이 죽으면 반쪽 스캔은 복원하지 않는 게 맞다.
        scan: s.phase === 'streaming' ? undefined : s.scan,
        cart: s.cart,
        convo: s.convo,
      }),
    },
  ),
)

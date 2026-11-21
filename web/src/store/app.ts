import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { resizeForUpload } from '../features/capture/resizeImage'
import { ApiError, chatTranslate, chatVoice, scanMenuStream } from '../lib/api'
import { apiErrorText, tr } from '../lib/i18n'
import { clearPending, getPending, getRecent, putPending, putRecent } from '../lib/db'
import { useProfile } from './profile'
import type { CaptureMode, MenuItem, MenuScanResponse } from '../types/api'
import type { TravelerLang } from '../types/locale'

/** 'scanning' = 첫 항목을 기다리는 중(화면은 로딩), 'streaming' = 항목이 들어오는 중(화면은 결과).
 *  둘을 나눠야 로딩 화면이 언제 결과 화면으로 넘어갈지 알 수 있다. */
type ScanPhase = 'idle' | 'resizing' | 'scanning' | 'streaming' | 'done' | 'error'

/** 같은 메뉴판에 같은 이름이 두 분류에 걸쳐 나올 수 있어 분류까지 묶어 키로 쓴다. */
export const itemKey = (item: MenuItem) => `${item.section} ${item.name_local}`

/** 진행 중인 스캔의 식별자와 중단 스위치.
 *
 *  ⚠️ 스트리밍 전에는 `/result` 에 **다 끝난 뒤에야** 도달했으므로 스캔이 겹칠 수 없었다.
 *  지금은 첫 항목(~2초)에 결과 화면이 뜨고 그 화면엔 탭바가 있다 — 사용자가 홈으로 가서
 *  **아직 흐르는 중에 새 스캔을 시작할 수 있다.** 그때 낡은 스트림을 방치하면:
 *    - 낡은 항목이 새 식당 목록에 섞이고
 *    - 낡은 스트림이 끝나며 `phase:'done'` 으로 새 스캔의 진행 상태를 덮어쓰고
 *    - 낡은 스트림이 실패하면 멀쩡한 새 스캔이 에러 화면으로 간다.
 *
 *  그래서 (1) 이전 요청을 abort 하고 — Gemini 토큰도 아낀다 — (2) 그래도 이미 큐에 들어간
 *  콜백이 있을 수 있으니 실행 번호로 한 번 더 막는다. 둘 중 하나만으로는 부족하다.
 */
let scanRun = 0
let scanAbort: AbortController | null = null

/** 활성 스캔을 끊고 진행 중이던 콜백을 전부 무효화한다. */
function cancelActiveScan() {
  scanAbort?.abort()
  scanAbort = null
  scanRun += 1
}

/** 이전 스캔을 끊고 새 세대를 시작한다. 반환한 isStale() 이 true 면 어떤 상태도 건드리면 안 된다. */
function beginScan() {
  cancelActiveScan()
  const run = scanRun
  const controller = new AbortController()
  scanAbort = controller
  return { controller, isStale: () => run !== scanRun }
}

/** 우리가 직접 쓴(이미 현지화된) 문구. **이것만** 화면에 그대로 내보낸다.
 *  그 밖의 Error 는 브라우저 원문('Load failed' 등 — 이슈 #33)일 수 있어 일반 문구로 바꾼다. */
class UserFacingError extends Error {}

/** 같은 사진으로 다시 읽으면 되는 실패. 메뉴판 자체 문제(no_menu_found 등)는 다시 읽어도 같다. */
const RETRYABLE = new Set(['stream_interrupted', 'network_error'])

/** 'merge' = 받다 만 항목이 있다 → 같은 사진을 다시 읽어 **빠진 것만** 붙인다(결과 화면 CTA).
 *  'restart' = 항목이 없거나 앱이 스캔 도중 죽었다 → 같은 사진으로 새로 읽는다(로딩 오류·홈 배너). */
export type Resumable = 'merge' | 'restart' | null

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
  sendChat: (
    text: string,
    direction: 'traveler2local' | 'local2traveler',
    sourceLang: string,
    travelerLang: TravelerLang,
  ) => Promise<void>
  /** 녹음 blob 을 /chat/voice 로 전사+번역해 넣는다. push-to-talk 가 부른다. */
  sendVoice: (
    audio: Blob,
    direction: 'traveler2local' | 'local2traveler',
    sourceLang: string,
    travelerLang: TravelerLang,
  ) => Promise<void>

  /** 촬영 → 축소 → 스캔. 화면 이동은 호출부(로딩 화면)가 phase 를 보고 한다. */
  startScan: (file: File) => Promise<void>
  reset: () => void

  /** 끊긴 스캔을 같은 사진(IndexedDB 의 업로드 축소본)으로 다시 읽을 수 있는가. 이슈 #33. */
  resumable: Resumable
  /** 'merge' 면 이미 받은 항목은 두고 빠진 것만 붙인다. 'restart' 면 새로 읽는다.
   *  **스캔이 시작되면** 바로 true 로 끝난다(완료를 기다리지 않는다). 보관된 사진이 없으면 false
   *  (호출부는 촬영으로 보낸다). 자동으로 부르지 않는다 — 과금·데이터. */
  resumeScan: () => Promise<boolean>
  /** 다시 읽기를 포기한다(홈 배너 닫기). */
  discardPending: () => void

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
    (set, get) => {
  /** 스트림을 받아 상태에 붙인다. merge=true 면 기존 목록에 **없는 것만** 붙인다(이어서 읽기). */
  async function streamInto(
    blob: Blob,
    {
      controller,
      isStale,
      merge,
      mode,
      travelerLang,
    }: {
      controller: AbortController
      isStale: () => boolean
      merge: boolean
      mode: CaptureMode
      travelerLang: TravelerLang
    },
  ) {
    // 이미 받은 항목의 itemKey 별 개수. 다시 읽은 스트림에서 그만큼 건너뛴다(같은 이름이 같은
    // 분류에 두 번 있을 수 있어 집합이 아니라 개수로 센다).
    const seen = new Map<string, number>()
    if (merge) for (const it of get().scan?.items ?? []) seen.set(itemKey(it), (seen.get(itemKey(it)) ?? 0) + 1)

    // 항목이 오는 대로 화면에 붙인다. 첫 항목이 ~2초에 오므로 24초 스피너가 사라진다.
    // meta 가 항상 먼저 오기 때문에 onItem 시점에 scan 은 반드시 존재한다.
    const tail = await scanMenuStream(blob, {
      mode,
      travelerLang,
      signal: controller.signal,
      onMeta: (meta) => {
        if (isStale()) return
        // 이어서 읽기: 식당 정보·scan_id 는 처음 받은 것을 유지한다.
        if (merge && get().scan) return set({ phase: 'streaming' })
        set({
          phase: 'streaming',
          scan: {
            ...meta,
            traveler_lang: meta.traveler_lang ?? travelerLang,
            items: [],
            warnings: [],
            // meta 줄이 왔다는 건 서버의 '메뉴판 없음' 가드를 이미 통과했다는 뜻이다.
            // (menu_found=false 면 meta 전에 error 줄로 끝난다 — api/app/services/gemini.py)
            menu_found: true,
            no_menu_reason: '',
            // done 이 오기 전까지는 알 수 없다. 화면은 이 값을 쓰지 않는다.
            meta: { model: '', latency_ms: 0, image_px: '' },
          },
        })
      },
      onItem: (item) => {
        if (isStale()) return
        const left = seen.get(itemKey(item)) ?? 0
        if (left > 0) {
          seen.set(itemKey(item), left - 1)
          return
        }
        set((s) => (s.scan ? { scan: { ...s.scan, items: [...s.scan.items, item] } } : {}))
      },
    })

    if (isStale()) return
    scanAbort = null
    const scan = get().scan
    if (!scan) {
      throw new UserFacingError(
        tr(travelerLang, {
          ko: '메뉴판을 읽지 못했어요. 다시 시도해주세요.',
          ja: 'メニューを読み取れませんでした。もう一度お試しください。',
        }),
      )
    }
    const complete = { ...scan, warnings: tail.warnings, meta: tail.meta }
    set({ scan: complete, phase: 'done', resumable: null })
    // 최근 식당 재열람용으로 결과 + 축소본을 IndexedDB 에 남긴다.
    // ⚠️ 완성된 뒤에만 저장한다 — 스트리밍 도중 저장하면 반쪽짜리 스캔이 '최근 식당'에 남는다.
    // 저장 실패가 핵심 흐름(스캔 성공)을 막지 않도록 조용히 삼킨다.
    void putRecent(complete, blob).catch(() => {})
    void clearPending().catch(() => {})
  }

  function failScan(err: unknown, controller: AbortController, isStale: () => boolean) {
    // 내가 밀려난 스캔이면 조용히 사라진다. 여기서 상태를 건드리면 abort 된 낡은 요청이
    // 멀쩡히 돌아가는 새 스캔을 에러 화면으로 보낸다.
    if (isStale()) return
    // ⚠️ abort() 를 먼저 부른다. 그냥 null 로 덮으면 아직 열려 있는 요청을 끊을 손잡이가
    //    사라져(cancelActiveScan 도 못 잡는다) Gemini 가 남은 항목을 계속 만든다.
    controller.abort()
    scanAbort = null

    const travelerLang = useProfile.getState().travelerLang
    // ⚠️ ApiError 와 UserFacingError 만 문구를 쓴다. 그 밖의 Error.message 는 브라우저 원문
    //    ('Load failed', 'Failed to fetch' …)이라 사용자에게 내보내지 않는다(이슈 #33).
    const message =
      err instanceof ApiError
        ? apiErrorText(travelerLang, err.code, err.message)
        : err instanceof UserFacingError
          ? err.message
          : tr(travelerLang, {
              ko: '알 수 없는 오류가 발생했어요.',
              ja: '不明なエラーが発生しました。',
            })
    const retryable = err instanceof ApiError && RETRYABLE.has(err.code)
    // 다시 읽어도 같은 실패(메뉴판 없음 등)면 사진을 들고 있을 이유가 없다 — 홈 배너도 안 뜨게.
    if (!retryable) void clearPending().catch(() => {})

    // 중간에 끊겼어도 이미 받은 항목은 유효하다(서버가 partial 로 알려준다).
    // 30개를 받아놓고 전부 버리는 건 사용자에게 최악이다 — 경고를 달고 살린다.
    const partial = get().scan
    if (partial && partial.items.length > 0) {
      set({
        phase: 'done',
        resumable: retryable ? 'merge' : null,
        scan: {
          ...partial,
          warnings: [
            ...partial.warnings,
            `${message} ${tr(travelerLang, { ko: '일부만 표시해요.', ja: '一部のみ表示します。' })}`,
          ],
        },
      })
      return
    }
    set({ phase: 'error', error: message, resumable: retryable ? 'restart' : null })
  }

  return {
  captureMode: 'poster',
  setCaptureMode: (mode) => set({ captureMode: mode }),

  preview: null,
  phase: 'idle',
  scan: null,
  error: null,
  hydrated: false,
  resumable: null,

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
  async sendChat(text, direction, sourceLang, travelerLang) {
    const { translated, reading } = await chatTranslate({
      text,
      source_lang: sourceLang,
      traveler_lang: travelerLang,
      direction,
    })
    // traveler2local: 내 말→현지어. local2traveler: 점원 말→내 언어.
    const bubble: ChatBubble =
      direction === 'traveler2local'
        ? { from: 'me', ko: text, local: translated, reading }
        : { from: 'them', local: text, ko: translated }
    set((s) => ({ convo: [...s.convo, bubble] }))
  },
  async sendVoice(audio, direction, sourceLang, travelerLang) {
    const { source_text, translated, reading } = await chatVoice(audio, {
      source_lang: sourceLang,
      traveler_lang: travelerLang,
      direction,
    })
    // traveler2local: 내 발화가 source_text. local2traveler: 점원 발화가 source_text.
    const bubble: ChatBubble =
      direction === 'traveler2local'
        ? { from: 'me', ko: source_text, local: translated, reading }
        : { from: 'them', local: source_text, ko: translated }
    set((s) => ({ convo: [...s.convo, bubble] }))
  },

  async startScan(file) {
    // 아직 흐르고 있는 스캔이 있으면 먼저 끊는다(위 주석 참고).
    const { controller, isStale } = beginScan()

    // 이전 촬영본의 objectURL 을 놓아준다(누수 방지).
    const previous = get().preview
    if (previous) URL.revokeObjectURL(previous)

    set({
      preview: URL.createObjectURL(file),
      phase: 'resizing',
      scan: null,
      error: null,
      resumable: null,
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
        throw new UserFacingError(
          tr(useProfile.getState().travelerLang, {
            ko: '이 사진은 열 수 없는 형식이에요. 다른 사진으로 시도해주세요.',
            ja: 'この写真は開けない形式です。別の写真をお試しください。',
          }),
        )
      }

      if (isStale()) return
      const mode = get().captureMode
      const travelerLang = useProfile.getState().travelerLang
      // ⚠️ 스트림을 열기 **전에** 남긴다. 끊긴 뒤엔 사진이 없다(objectURL 은 리로드에 죽는다).
      //    done 에서 지운다. 저장 실패가 스캔을 막지 않게 조용히 삼킨다.
      void putPending({ image: resized.blob, mode, travelerLang, startedAt: Date.now() }).catch(() => {})
      set({ phase: 'scanning' })

      await streamInto(resized.blob, { controller, isStale, merge: false, mode, travelerLang })
    } catch (err) {
      failScan(err, controller, isStale)
    }
  },

  async resumeScan() {
    const pending = await getPending().catch(() => undefined)
    if (!pending) {
      set({ resumable: null })
      return false
    }
    const current = get().scan
    const merge = get().resumable === 'merge' && current !== null
    const { controller, isStale } = beginScan()

    if (merge) {
      // 결과 화면에 그대로 머문다. 끊김 경고는 걷어낸다(다시 끊기면 다시 붙는다).
      set({ phase: 'streaming', resumable: null, error: null, scan: { ...current, warnings: [] } })
    } else {
      const previous = get().preview
      if (previous) URL.revokeObjectURL(previous)
      set({
        preview: URL.createObjectURL(pending.image),
        phase: 'scanning',
        scan: null,
        error: null,
        resumable: null,
        cart: {},
        convo: [],
      })
    }

    // 시작만 하고 돌아간다 — 호출부(홈 배너)가 phase 가 바뀐 **뒤에** 로딩 화면으로 가야
    // 로딩 화면의 가드('idle' → 홈, 'done' → 옛 결과)에 튕기지 않는다.
    void streamInto(pending.image, {
      controller,
      isStale,
      merge,
      mode: pending.mode,
      travelerLang: pending.travelerLang,
    }).catch((err) => failScan(err, controller, isStale))
    return true
  },

  discardPending() {
    void clearPending().catch(() => {})
    set({ resumable: null })
  },

  reset() {
    // 스트리밍 중에 홈으로 돌아와 초기화할 수 있다 — 흐르던 스트림을 끊지 않으면
    // 비운 직후에 낡은 항목이 다시 채워진다.
    cancelActiveScan()
    // 스스로 버린 세션이다 — 홈에 '다시 읽기' 배너가 뜨면 안 된다.
    void clearPending().catch(() => {})
    // 활성 세션만 비운다 — IndexedDB 의 "최근 식당" 기록은 남겨 재열람할 수 있게 한다.
    const previous = get().preview
    if (previous) URL.revokeObjectURL(previous)
    set({ preview: null, phase: 'idle', scan: null, error: null, resumable: null, cart: {}, convo: [] })
  },

  async hydrate() {
    if (get().hydrated) return
    set({ hydrated: true })
    // 스캔 도중 앱이 죽었으면(iOS 가 백그라운드 PWA 를 정리 등) 축소본이 남아 있다 → 홈 배너.
    // 기다리지 않는다 — 아래 세션 복원을 늦출 이유가 없다.
    void getPending()
      .catch(() => undefined)
      .then((pending) => {
        // 그 사이 사용자가 새 스캔을 시작했으면 그 스캔의 축소본이다 — 손대지 않는다.
        if (scanAbort) return
        if (!pending) {
          if (get().resumable) set({ resumable: null })
        } else if (get().resumable !== 'merge') {
          set({ resumable: 'restart' })
        }
      })
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
    // 스트리밍 중에 '최근 식당' 을 열 수 있다. 낡은 스트림이 이 목록에 항목을 섞지 않게 끊는다.
    // ⚠️ 기록이 없어 되돌아가는 위 경우에는 끊지 않는다 — 보던 화면이 그대로 남아야 한다.
    cancelActiveScan()
    void clearPending().catch(() => {}) // 끊긴 스캔을 버리고 다른 식당으로 간다
    const previous = get().preview
    if (previous) URL.revokeObjectURL(previous)
    set({
      scan: entry.scan,
      resumable: null,
      preview: entry.image ? URL.createObjectURL(entry.image) : null,
      phase: 'done',
      error: null,
      cart: {}, // 다시 여는 식당은 새로 담는다
      convo: [],
    })
    return true
  },
  }
    },
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
        // 결과 화면의 '이어서 읽기' 가 재실행 뒤에도 남도록. 축소본은 IndexedDB 에 있다.
        resumable: s.resumable === 'merge' ? s.resumable : null,
      }),
    },
  ),
)

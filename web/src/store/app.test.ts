/** 스캔 세션 store — 특히 **낡은 스캔 가드**(scanRun 세대 카운터 + AbortController).
 *
 *  왜 이 파일이 있나: 스트리밍 도입 전에는 `/result` 에 다 끝난 뒤에야 도달했으므로 스캔이
 *  겹칠 수 없었다. 지금은 첫 항목(~2초)에 결과 화면이 뜨고 그 화면엔 탭바가 있어 **아직
 *  흐르는 중에 새 스캔을 시작할 수 있다.** 그때 낡은 스트림을 방치하면 (1) 낡은 항목이 새
 *  식당 목록에 섞이고 (2) 낡은 스트림이 `phase:'done'` 으로 새 스캔을 덮어쓰고 (3) 낡은
 *  스트림이 실패하면 멀쩡한 새 스캔이 에러 화면으로 간다.
 *
 *  이 셋은 전부 DOM 도 네트워크도 없는 **순수 상태 전이**다 — 리뷰어 눈이 아니라 여기서 잡는다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScanStreamHandlers } from '../lib/api'
import type { MenuItem, MenuScanResponse, Restaurant } from '../types/api'

// ApiError 는 진짜를 쓴다(store 가 instanceof 로 분기한다). 함수만 갈아끼운다.
vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  scanMenuStream: vi.fn(),
  chatTranslate: vi.fn(),
  chatVoice: vi.fn(),
}))
vi.mock('../lib/db', () => ({ putRecent: vi.fn(), getRecent: vi.fn() }))
// factory 로 목하면 실제 모듈이 로드되지 않는다 —
// `new Worker(new URL('./resize.worker.ts', import.meta.url))` 를 node 에서 해석할 일이 없다.
vi.mock('../features/capture/resizeImage', () => ({ resizeForUpload: vi.fn() }))

interface Deferred<T> {
  promise: Promise<T>
  resolve: (v: T) => void
  reject: (e: unknown) => void
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

type Tail = { warnings: string[]; meta: MenuScanResponse['meta'] }
interface FakeScan {
  handlers: ScanStreamHandlers
  signal: AbortSignal | undefined
  mode: string | undefined
  travelerLang: string | undefined
  d: Deferred<Tail>
}

const restaurant = (name: string): Restaurant => ({
  name_local: name,
  name_translated: name,
  cuisine_hint: '',
})
const metaOf = (id: string, name: string) => ({
  scan_id: id,
  source_lang: 'ja',
  currency: 'JPY',
  restaurant: restaurant(name),
})
const item = (nameLocal: string): MenuItem => ({
  name_local: nameLocal,
  name_translated: nameLocal,
  price_text: '190円',
  price_amount: 190,
  tax_included: true,
  category: 'food',
  section: '꼬치',
  summary: '한 줄 설명',
  image_query: 'yakitori',
  tags: [],
  allergens: [],
  ocr_confidence: 'high',
})
const TAIL: Tail = {
  warnings: ['오른쪽이 잘렸어요'],
  meta: { model: 'gemini-3.1-flash-lite', latency_ms: 9000, image_px: '2048x1536' },
}

let calls: FakeScan[]
let useApp: typeof import('./app').useApp
let db: typeof import('../lib/db')
let resize: typeof import('../features/capture/resizeImage')

/** ⚠️ scanRun/scanAbort 는 모듈 레벨이고 store 는 싱글턴이라 **케이스 사이에 리셋되지 않는다**
 *  (파일 사이는 vitest 의 isolate 가 공짜로 해결해준다). resetModules 로 모듈 그래프를 새로
 *  만들어야 세대 카운터가 0 으로 돌아간다.
 *
 *  ⚠️ `vi.mock` 팩토리는 **resetModules 로 다시 실행되지 않는다** — 목 함수는 파일 전체에서
 *  같은 인스턴스다. 그래서 기본 구현을 팩토리가 아니라 여기서 심는다. 팩토리에 넣으면 어떤
 *  케이스가 `mockResolvedValue` 로 덮은 값이 다음 케이스로 새어 나간다(clearMocks 는 호출
 *  기록만 지우고 구현은 남긴다). 실제로 한 번 당했다.
 *
 *  ⚠️ db 목은 반드시 Promise 를 돌려줘야 한다. startScan 은 try 블록 안에서
 *  `putRecent(...).catch(…)` 를 부른다 — undefined 를 돌려주면 거기서 TypeError 가 나고
 *  store 가 그걸 '스캔 실패' 로 보고한다. 멀쩡해 보이는데 빨간, 시간 태우기 딱 좋은 함정.
 *
 *  store 는 맨 마지막에 import 한다(setup.ts 의 storage.clear() 가 먼저 돌아 이전 케이스
 *  세션이 rehydrate 되지 않게). */
beforeEach(async () => {
  vi.resetModules()
  calls = []

  const api = await import('../lib/api')
  vi.mocked(api.scanMenuStream).mockImplementation((_blob, opts) => {
    const d = deferred<Tail>()
    calls.push({
      handlers: opts,
      signal: opts.signal,
      mode: opts.mode,
      travelerLang: opts.travelerLang,
      d,
    })
    return d.promise
  })

  db = await import('../lib/db')
  vi.mocked(db.putRecent).mockImplementation(async () => {})
  vi.mocked(db.getRecent).mockImplementation(async () => undefined)

  resize = await import('../features/capture/resizeImage')
  vi.mocked(resize.resizeForUpload).mockImplementation(async (file) => ({
    blob: new Blob(['resized'], { type: 'image/jpeg' }),
    width: 2048,
    height: 1536,
    originalBytes: file.size,
  }))

  let n = 0
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:test-${++n}`)
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  ;({ useApp } = await import('./app'))
})

afterEach(() => {
  vi.restoreAllMocks()
})

const state = () => useApp.getState()
const startScan = (name: string) =>
  state().startScan(new File(['photo'], name, { type: 'image/jpeg' }))
/** resizeForUpload 의 마이크로태스크를 세는 대신, 스트림 호출이 도착했는지로 동기화한다. */
const awaitCall = (n: number) => vi.waitFor(() => expect(calls).toHaveLength(n))
const session = () =>
  JSON.parse(localStorage.getItem('dipeat:session') ?? '{"state":{}}').state as Record<
    string,
    unknown
  >

describe('startScan', () => {
  it('uses the selected traveler language for a new scan', async () => {
    const { useProfile } = await import('./profile')
    useProfile.getState().setTravelerLang('ja')
    void startScan('ko-menu.jpg')
    await awaitCall(1)
    expect(calls[0].travelerLang).toBe('ja')
  })

  // 스트리밍의 존재 이유 — 첫 항목이 오는 즉시 결과 화면으로 넘어간다.
  it('emits items into the store as they stream in', async () => {
    void startScan('a.jpg')
    await awaitCall(1)
    expect(state().phase).toBe('scanning')

    calls[0].handlers.onMeta(metaOf('scan-a', '엔야'))
    expect(state().phase).toBe('streaming')
    expect(state().scan?.restaurant.name_local).toBe('엔야')
    // meta 줄이 왔다는 건 서버의 '메뉴판 없음' 가드를 이미 통과했다는 뜻이다
    // (menu_found=false 면 meta 전에 error 줄로 끝난다).
    expect(state().scan?.menu_found).toBe(true)

    calls[0].handlers.onItem(item('かわ'))
    calls[0].handlers.onItem(item('レバー'))
    expect(state().scan?.items.map((i) => i.name_local)).toEqual(['かわ', 'レバー'])
  })

  // 다른 식당이므로 이전 장바구니·대화가 넘어오면 안 된다.
  it('clears cart and conversation because a new scan is a different restaurant', async () => {
    state().addToCart('꼬치 かわ')
    state().pushBubble({ from: 'me', local: 'すみません', ko: '저기요' })

    void startScan('a.jpg')
    await awaitCall(1)
    expect(state().cart).toEqual({})
    expect(state().convo).toEqual([])
  })

  // 촬영본마다 objectURL 을 만들면서 놓아주지 않으면 누수된다.
  it('revokes the previous preview objectURL', async () => {
    void startScan('a.jpg')
    await awaitCall(1)
    const first = state().preview

    void startScan('b.jpg')
    await awaitCall(2)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(first)
  })

  // ⚠️ 완성된 뒤에만 저장한다 — 스트리밍 도중 저장하면 반쪽짜리 스캔이 '최근 식당'에 남는다.
  it('saves to recents only after the stream completes', async () => {
    void startScan('a.jpg')
    await awaitCall(1)
    calls[0].handlers.onMeta(metaOf('scan-a', '엔야'))
    calls[0].handlers.onItem(item('かわ'))
    expect(db.putRecent).not.toHaveBeenCalled()

    calls[0].d.resolve(TAIL)
    await vi.waitFor(() => expect(state().phase).toBe('done'))
    expect(db.putRecent).toHaveBeenCalledTimes(1)
    expect(vi.mocked(db.putRecent).mock.calls[0][0]).toMatchObject({
      scan_id: 'scan-a',
      warnings: TAIL.warnings,
      meta: TAIL.meta,
    })
  })

  // 모드가 빠지면 책자형 메뉴판이 포스터 프롬프트로 돌아간다.
  it('sends the current capture mode to the server', async () => {
    state().setCaptureMode('booklet')
    void startScan('a.jpg')
    await awaitCall(1)
    expect(calls[0].mode).toBe('booklet')
  })
})

describe('stale scan guard', () => {
  /** A 를 흘리는 도중 B 를 시작한 상태를 만든다. 반환값으로 A 의 낡은 콜백을 손으로 부른다. */
  async function overlap() {
    const pA = startScan('a.jpg')
    await awaitCall(1)
    calls[0].handlers.onMeta(metaOf('scan-a', '엔야'))
    calls[0].handlers.onItem(item('かわ'))

    const pB = startScan('b.jpg')
    await awaitCall(2)
    calls[1].handlers.onMeta(metaOf('scan-b', '토리키조쿠'))
    calls[1].handlers.onItem(item('ねぎま'))
    return { pA, pB }
  }

  // 상태 보호뿐 아니라 Gemini 출력 토큰을 아끼는 것도 목적이다.
  it('aborts the previous request when a new scan starts', async () => {
    await overlap()
    expect(calls[0].signal?.aborted).toBe(true)
    expect(calls[1].signal?.aborted).toBe(false)
  })

  // abort 해도 이미 큐에 들어간 콜백이 있을 수 있다 — 세대 카운터가 따로 있는 이유다.
  it('does not append items from the previous scan into the new one', async () => {
    await overlap()
    calls[0].handlers.onItem(item('つくね'))
    expect(state().scan?.items.map((i) => i.name_local)).toEqual(['ねぎま'])
  })

  it('does not let a late meta from the previous scan replace the new restaurant', async () => {
    await overlap()
    calls[0].handlers.onMeta(metaOf('scan-a', '엔야'))
    expect(state().scan?.scan_id).toBe('scan-b')
    expect(state().scan?.restaurant.name_local).toBe('토리키조쿠')
  })

  // 낡은 스트림이 끝나며 phase:'done' 으로 진행 중인 새 스캔을 덮어쓰던 버그.
  it('does not mark the new scan done when the previous stream finishes', async () => {
    const { pA } = await overlap()
    calls[0].d.resolve(TAIL)
    await pA
    expect(state().phase).toBe('streaming')
    expect(state().scan?.warnings).toEqual([])
    expect(db.putRecent).not.toHaveBeenCalled()
  })

  // 가장 나쁜 증상 — 낡은 실패가 멀쩡한 새 스캔을 에러 화면으로 보낸다.
  it('does not send the new scan to the error screen when the previous stream fails', async () => {
    const { pA } = await overlap()
    const { ApiError } = await import('../lib/api')
    calls[0].d.reject(new ApiError(0, { code: 'network_error', message: '연결에 실패했어요.' }))
    await pA
    expect(state().phase).toBe('streaming')
    expect(state().error).toBeNull()
  })

  // 부분 살리기 경로(items.length>0)가 stale 검사보다 **뒤**에 있어야 한다.
  it('does not salvage partial items from a stale scan', async () => {
    const { pA } = await overlap()
    calls[0].d.reject(new Error('스트림이 끊겼어요.'))
    await pA
    expect(state().scan?.items.map((i) => i.name_local)).toEqual(['ねぎま'])
    expect(state().scan?.warnings).toEqual([])
    expect(state().phase).toBe('streaming')
  })

  // 낡은 스캔이 scanAbort=null 을 해버리면 이후 reset()·새 스캔이 살아있는 요청을 못 끊는다.
  it('does not clear the active abort handle when a stale scan settles', async () => {
    const { pA } = await overlap()
    calls[0].d.resolve(TAIL)
    await pA

    state().reset()
    expect(calls[1].signal?.aborted).toBe(true)
  })
})

describe('failure handling', () => {
  // ⚠️ abort 없이 핸들만 버리면 아직 열려 있는 요청을 끊을 손잡이가 사라져
  //    Gemini 가 남은 항목의 출력 토큰을 계속 만든다.
  it('aborts its own request before giving up', async () => {
    const p = startScan('a.jpg')
    await awaitCall(1)
    calls[0].d.reject(new Error('실패'))
    await p
    expect(calls[0].signal?.aborted).toBe(true)
  })

  // 30개를 받아놓고 전부 버리는 건 사용자에게 최악이다 — 경고를 달고 살린다.
  it('keeps already-received items and appends a warning when the stream breaks', async () => {
    const p = startScan('a.jpg')
    await awaitCall(1)
    calls[0].handlers.onMeta(metaOf('scan-a', '엔야'))
    calls[0].handlers.onItem(item('かわ'))
    calls[0].handlers.onItem(item('レバー'))

    calls[0].d.reject(new Error('스트림이 끊겼어요.'))
    await p
    expect(state().phase).toBe('done')
    expect(state().scan?.items).toHaveLength(2)
    expect(state().scan?.warnings.at(-1)).toBe('스트림이 끊겼어요. 일부만 표시해요.')
  })

  it('goes to the error screen only when nothing arrived', async () => {
    const p = startScan('a.jpg')
    await awaitCall(1)
    calls[0].handlers.onMeta(metaOf('scan-a', '엔야'))
    calls[0].d.reject(new Error('메뉴판을 읽지 못했어요.'))
    await p
    expect(state().phase).toBe('error')
    expect(state().error).toBe('메뉴판을 읽지 못했어요.')
  })

  // 브라우저가 못 디코드하는 형식(HEIC 변환 실패 등). 원문 영문 메시지를 그대로 보여주면 안 된다.
  it('shows a Korean message when the photo cannot be decoded', async () => {
    vi.mocked(resize.resizeForUpload).mockRejectedValueOnce(
      new Error('The source image cannot be decoded'),
    )
    await startScan('a.jpg')
    expect(state().phase).toBe('error')
    expect(state().error).toBe('이 사진은 열 수 없는 형식이에요. 다른 사진으로 시도해주세요.')
    expect(calls).toHaveLength(0)
  })
})

describe('reset / openRecent', () => {
  // 비운 직후에 낡은 항목이 다시 채워지던 경로.
  it('reset aborts the streaming scan so late items cannot refill it', async () => {
    void startScan('a.jpg')
    await awaitCall(1)
    calls[0].handlers.onMeta(metaOf('scan-a', '엔야'))

    state().reset()
    expect(calls[0].signal?.aborted).toBe(true)

    calls[0].handlers.onItem(item('かわ'))
    expect(state().scan).toBeNull()
    expect(state().phase).toBe('idle')
  })

  it('openRecent aborts the streaming scan before swapping the session', async () => {
    const saved = {
      scanId: 'scan-old',
      savedAt: 0,
      image: null,
      scan: {
        scan_id: 'scan-old',
        menu_found: true,
        no_menu_reason: '',
        source_lang: 'ja',
        currency: 'JPY',
        restaurant: restaurant('예전 식당'),
        items: [item('とり')],
        warnings: [],
        meta: TAIL.meta,
      } satisfies MenuScanResponse,
    }
    vi.mocked(db.getRecent).mockResolvedValue(saved)

    void startScan('a.jpg')
    await awaitCall(1)
    calls[0].handlers.onMeta(metaOf('scan-a', '엔야'))

    expect(await state().openRecent('scan-old')).toBe(true)
    expect(calls[0].signal?.aborted).toBe(true)

    calls[0].handlers.onItem(item('かわ'))
    expect(state().scan?.scan_id).toBe('scan-old')
    expect(state().scan?.items.map((i) => i.name_local)).toEqual(['とり'])
  })

  // ⚠️ 기록이 없어 되돌아가는 경우엔 보던 화면이 그대로 남아야 한다 — 끊지 않는다.
  it('openRecent leaves the running scan alone when the record is gone', async () => {
    void startScan('a.jpg')
    await awaitCall(1)
    calls[0].handlers.onMeta(metaOf('scan-a', '엔야'))

    expect(await state().openRecent('사라진-기록')).toBe(false)
    expect(calls[0].signal?.aborted).toBe(false)

    calls[0].handlers.onItem(item('かわ'))
    expect(state().scan?.items).toHaveLength(1)
  })

  // 같은 식당을 다시 여는 건 세션 유지다(장바구니를 비우면 담아둔 게 날아간다).
  it('openRecent on the already-open scan keeps cart and conversation', async () => {
    void startScan('a.jpg')
    await awaitCall(1)
    calls[0].handlers.onMeta(metaOf('scan-a', '엔야'))
    state().addToCart('꼬치 かわ')

    expect(await state().openRecent('scan-a')).toBe(true)
    expect(state().cart).toEqual({ '꼬치 かわ': 1 })
    expect(db.getRecent).not.toHaveBeenCalled()
  })
})

describe('cart', () => {
  // 0 이 남으면 cartLines 가 빈 줄을 그린다.
  it('removing the last unit deletes the key instead of leaving a zero', () => {
    state().addToCart('꼬치 かわ')
    state().removeFromCart('꼬치 かわ')
    expect(state().cart).toEqual({})
  })
})

describe('persist', () => {
  // ⚠️ persist 는 상태가 바뀔 때마다 쓴다. 항목마다 쓰면 90개짜리 메뉴판에서 '점점 커지는
  //    JSON' 을 90번 직렬화한다(누적 1MB+). 모바일에서 눈에 띄게 버벅인다.
  it('does not persist a scan while items are still streaming', async () => {
    void startScan('a.jpg')
    await awaitCall(1)
    calls[0].handlers.onMeta(metaOf('scan-a', '엔야'))
    calls[0].handlers.onItem(item('かわ'))

    expect(state().phase).toBe('streaming')
    expect(session().scan).toBeUndefined()
  })

  it('persists the scan once it is complete', async () => {
    void startScan('a.jpg')
    await awaitCall(1)
    calls[0].handlers.onMeta(metaOf('scan-a', '엔야'))
    calls[0].handlers.onItem(item('かわ'))
    calls[0].d.resolve(TAIL)
    await vi.waitFor(() => expect(state().phase).toBe('done'))

    expect((session().scan as MenuScanResponse).items).toHaveLength(1)
  })

  // preview(objectURL)·phase·error 는 리로드에 되살릴 수 없거나 되살리면 안 되는 값이다.
  it('never persists preview, phase or error', async () => {
    void startScan('a.jpg')
    await awaitCall(1)
    calls[0].handlers.onMeta(metaOf('scan-a', '엔야'))
    calls[0].d.resolve(TAIL)
    await vi.waitFor(() => expect(state().phase).toBe('done'))

    expect(Object.keys(session()).sort()).toEqual(['captureMode', 'cart', 'convo', 'scan'])
  })
})

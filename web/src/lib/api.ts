import type {
  ApiErrorBody,
  CaptureMode,
  ExplainRequest,
  ExplainResponse,
  LocateResponse,
  MenuItem,
  MenuScanResponse,
  Restaurant,
} from '../types/api'

/** '사진에서 확인' 이 보내는 대상 항목. index 는 1부터, 응답 박스와 1:1 로 맞춘다. */
export interface LocateTarget {
  index: number
  name_local: string
  section: string
}

/** 서버가 내려준 한국어 메시지를 그대로 사용자에게 보여주기 위한 에러. */
export class ApiError extends Error {
  readonly code: string
  readonly status: number
  readonly detail?: string | null

  constructor(status: number, body: ApiErrorBody) {
    super(body.message)
    this.name = 'ApiError'
    this.status = status
    this.code = body.code
    this.detail = body.detail
  }
}

const GENERIC: ApiErrorBody = {
  code: 'network_error',
  message: '연결에 실패했어요. 네트워크를 확인하고 다시 시도해주세요.',
}

async function toApiError(resp: Response): Promise<ApiError> {
  try {
    const body = (await resp.json()) as ApiErrorBody
    if (body?.message) return new ApiError(resp.status, body)
  } catch {
    /* JSON 이 아닌 응답(프록시 5xx 등)은 아래 일반 메시지로 */
  }
  return new ApiError(resp.status, GENERIC)
}

export async function scanMenu(
  image: Blob,
  { mode = 'poster', signal }: { mode?: CaptureMode; signal?: AbortSignal } = {},
): Promise<MenuScanResponse> {
  const form = new FormData()
  form.append('image', image, 'menu.jpg')
  form.append('mode', mode)

  let resp: Response
  try {
    resp = await fetch('/api/v1/menu/scan', { method: 'POST', body: form, signal })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new ApiError(0, GENERIC)
  }

  if (!resp.ok) throw await toApiError(resp)
  return (await resp.json()) as MenuScanResponse
}

/** 스캔 스트림이 알려주는 것. `/menu/scan/stream` 의 NDJSON 계약과 1:1. */
export interface ScanStreamHandlers {
  /** 첫 항목보다 먼저 온다 — 가게 이름·통화를 바로 그릴 수 있다. */
  onMeta: (meta: {
    scan_id: string
    source_lang: string
    currency: string
    restaurant: Restaurant
  }) => void
  /** 항목 하나가 완성될 때마다. 실측 첫 항목 ~2초, 이후 ~0.4초 간격. */
  onItem: (item: MenuItem) => void
}

/** 1단계(스트리밍): 사진 → 목록을 항목이 완성되는 대로 받는다.
 *
 *  왜 이게 있나: 지연이 거의 전부 출력 토큰에서 나와서, 54개 메뉴판은 통째로 받으면
 *  24초를 기다린다. 스트리밍하면 **첫 카드가 ~2초**에 뜬다(실측). 총 시간은 같다.
 *
 *  ⚠️ **HTTP 상태가 항상 200 이다.** 첫 바이트가 나가는 순간 상태가 확정되므로 서버가
 *  생성 도중 난 오류를 4xx/5xx 로 바꿀 수 없다. 그래서 오류는 본문의 `type:"error"`
 *  줄로 온다 — `resp.ok` 만 보고 성공으로 판단하면 안 된다.
 *
 *  실패해도 그때까지 받은 항목은 유효하다(`partial`). 호출부가 살릴지 버릴지 정한다.
 */
export async function scanMenuStream(
  image: Blob,
  {
    mode = 'poster',
    signal,
    onMeta,
    onItem,
  }: { mode?: CaptureMode; signal?: AbortSignal } & ScanStreamHandlers,
): Promise<{ warnings: string[]; meta: MenuScanResponse['meta'] }> {
  const form = new FormData()
  form.append('image', image, 'menu.jpg')
  form.append('mode', mode)

  let resp: Response
  try {
    resp = await fetch('/api/v1/menu/scan/stream', { method: 'POST', body: form, signal })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new ApiError(0, GENERIC)
  }
  // 스트림이 시작되기 '전에' 죽은 경우(413, 프록시 5xx 등)는 평소대로 상태가 온다.
  if (!resp.ok) throw await toApiError(resp)
  if (!resp.body) throw new ApiError(0, GENERIC)

  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let tail: { warnings: string[]; meta: MenuScanResponse['meta'] } | null = null

  const handle = (line: string) => {
    if (!line.trim()) return
    // 한 줄이 깨졌다고 스캔 전체를 버리지 않는다 — 나머지 줄은 멀쩡하다.
    let event: Record<string, unknown>
    try {
      event = JSON.parse(line)
    } catch {
      return
    }
    switch (event.type) {
      case 'meta':
        onMeta(event as never)
        break
      case 'item':
        onItem(event.item as MenuItem)
        break
      case 'done':
        tail = { warnings: (event.warnings as string[]) ?? [], meta: event.meta as never }
        break
      case 'error':
        throw new ApiError(200, {
          code: String(event.code ?? 'upstream_error'),
          message: String(event.message ?? GENERIC.message),
        })
    }
  }

  // ⚠️ finally 가 없으면 중간에 throw 될 때(서버가 error 줄을 보낸 경우 등) reader 가 잠긴 채
  //    연결이 살아 있어, Gemini 가 남은 항목의 출력 토큰을 계속 만든다. 취소하는 게 요점이다.
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      // NDJSON: 마지막 조각은 아직 줄이 안 끝났을 수 있으니 버퍼에 남긴다.
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) handle(line)
    }
    handle(buffer)
  } finally {
    void reader.cancel().catch(() => {}) // 락도 함께 풀린다
  }

  // done 없이 스트림이 끊겼다 — 네트워크가 중간에 죽은 경우.
  if (!tail) throw new ApiError(0, GENERIC)
  return tail
}

/** 2단계: 카드를 탭했을 때만 부른다.
 *
 *  사진을 다시 보내지 않는 텍스트 전용 호출이라 목록 스캔보다 훨씬 싸고 빠르다.
 *  같은 메뉴를 두 번 묻지 않도록 호출부에서 name_local 로 캐시할 것. */
export async function explainItem(
  body: ExplainRequest,
  { signal }: { signal?: AbortSignal } = {},
): Promise<ExplainResponse> {
  let resp: Response
  try {
    resp = await fetch('/api/v1/menu/item/explain', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new ApiError(0, GENERIC)
  }

  if (!resp.ok) throw await toApiError(resp)
  return (await resp.json()) as ExplainResponse
}

/** 3단계: '사진에서 확인' 탭을 열 때만. 축소본 사진 + 장바구니 대상 → 각 항목의 사진 속 위치.
 *
 *  사진(Gemini 가 스캔 때 본 것과 같은 축소 Blob)을 다시 보내는 비전 호출이라, 목록 스캔처럼
 *  항목 수로 곱해지진 않아도 텍스트 전용 explain 보다는 무겁다. 좌표는 scan_id 별로 캐시할 것. */
export async function locateItems(
  image: Blob,
  targets: LocateTarget[],
  { signal }: { signal?: AbortSignal } = {},
): Promise<LocateResponse> {
  const form = new FormData()
  form.append('image', image, 'menu.jpg')
  form.append('targets', JSON.stringify(targets))

  let resp: Response
  try {
    resp = await fetch('/api/v1/menu/locate', { method: 'POST', body: form, signal })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new ApiError(0, GENERIC)
  }

  if (!resp.ok) throw await toApiError(resp)
  return (await resp.json()) as LocateResponse
}

/** 점원 대화 — 자유 발화 번역. 주문 카드는 이걸 부르지 않는다(오프라인 조립). */
export async function chatTranslate(
  body: { text: string; source_lang: string; direction: 'ko2local' | 'local2ko' },
  { signal }: { signal?: AbortSignal } = {},
): Promise<{ translated: string; reading: string }> {
  let resp: Response
  try {
    resp = await fetch('/api/v1/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new ApiError(0, GENERIC)
  }
  if (!resp.ok) throw await toApiError(resp)
  return (await resp.json()) as { translated: string; reading: string }
}

/** 점원 대화 — 음성 받아쓰기 + 번역(홀드-투-토크). */
export async function chatVoice(
  audio: Blob,
  body: { source_lang: string; direction: 'ko2local' | 'local2ko' },
  { signal }: { signal?: AbortSignal } = {},
): Promise<{ source_text: string; translated: string; reading: string }> {
  const form = new FormData()
  form.append('audio', audio, 'clip.webm')
  form.append('direction', body.direction)
  form.append('source_lang', body.source_lang)

  let resp: Response
  try {
    resp = await fetch('/api/v1/chat/voice', { method: 'POST', body: form, signal })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new ApiError(0, GENERIC)
  }
  if (!resp.ok) throw await toApiError(resp)
  return (await resp.json()) as { source_text: string; translated: string; reading: string }
}

/** 발표 직전 Cloud Run 인스턴스를 깨워두기 위한 호출. 실패해도 무시한다. */
export async function warmUp(): Promise<void> {
  try {
    await fetch('/api/v1/health', { cache: 'no-store' })
  } catch {
    /* 워밍업 실패는 사용자에게 알릴 일이 아니다 */
  }
}

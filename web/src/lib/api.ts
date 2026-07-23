import type {
  ApiErrorBody,
  CaptureMode,
  ExplainRequest,
  ExplainResponse,
  MenuScanResponse,
} from '../types/api'

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

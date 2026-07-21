import type { ApiErrorBody, CaptureMode, MenuScanResponse } from '../types/api'

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

/** 발표 직전 Cloud Run 인스턴스를 깨워두기 위한 호출. 실패해도 무시한다. */
export async function warmUp(): Promise<void> {
  try {
    await fetch('/api/v1/health', { cache: 'no-store' })
  } catch {
    /* 워밍업 실패는 사용자에게 알릴 일이 아니다 */
  }
}

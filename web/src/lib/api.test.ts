/** `/menu/scan/stream` NDJSON 클라이언트 계약.
 *
 *  서버 쪽 대응물은 `api/tests/test_jsonstream.py` 다 — 거기서는 파서에 한 글자씩 먹여
 *  "조각 경계가 어디 떨어져도 결과가 같다"를 지킨다. 스트림을 **받는 절반**은 지금까지
 *  아무도 안 봤다. 이 파일이 그 절반이다.
 *
 *  여기서 지키는 계약 셋:
 *   1. 조각 경계 독립성 — 청크 크기가 1이든 64든 같은 이벤트가 같은 순서로 나온다.
 *   2. HTTP 상태가 항상 200 — 오류는 본문의 `{"type":"error"}` 줄로 온다. `resp.ok` 만 보면
 *      실패를 성공으로 읽는다.
 *   3. 어떤 경로로 빠져나가든 reader 를 취소한다 — 안 그러면 연결이 살아 있어 Gemini 가
 *      남은 항목의 출력 토큰을 계속 만든다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, scanMenuStream } from './api'
import type { MenuItem } from '../types/api'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.restoreAllMocks()
})

function item(nameLocal: string, nameKo: string): MenuItem {
  return {
    name_local: nameLocal,
    name_translated: nameKo,
    price_text: '190円',
    price_amount: 190,
    tax_included: true,
    category: 'food',
    section: '꼬치',
    summary: '닭 껍질 꼬치구이',
    image_query: 'yakitori kawa',
    tags: [],
    allergens: [],
    ocr_confidence: 'high',
  }
}

const META = {
  type: 'meta',
  scan_id: 'scan-1',
  source_lang: 'ja',
  currency: 'JPY',
  restaurant: {
    name_local: '炭火焼鳥 ゑんや',
    name_translated: '숯불 야키토리 엔야',
    cuisine_hint: '야키토리',
  },
}
const DONE = {
  type: 'done',
  warnings: ['메뉴판 오른쪽이 잘려 일부를 읽지 못했어요'],
  meta: { model: 'gemini-3.1-flash-lite', latency_ms: 10234, image_px: '2048x1536' },
}
const LINES = [
  JSON.stringify(META),
  JSON.stringify({ type: 'item', item: item('かわ', '카와') }),
  JSON.stringify({ type: 'item', item: item('レバー', '레바') }),
  JSON.stringify(DONE),
]
/** 서버가 실제로 보내는 모양: 줄마다 개행, 마지막 줄에도 개행. */
const NDJSON = LINES.join('\n') + '\n'

/** ⚠️ 문자가 아니라 **바이트**로 자른다. 픽스처에 일본어·한국어가 있으므로 size=1 이면
 *  멀티바이트 문자 한가운데가 잘린다 — `decoder.decode(v, {stream:true})` 가 그걸 견디는지가
 *  이 테스트의 요점이다. 문자 단위로 자르면 그 경로를 한 번도 안 밟는다. */
function bodyOf(text: string, chunk = 4096) {
  const bytes = new TextEncoder().encode(text)
  let i = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= bytes.length) return controller.close()
      const end = Math.min(i + chunk, bytes.length)
      controller.enqueue(bytes.slice(i, end))
      i = end
    },
  })
  const reader = stream.getReader()
  const cancel = vi.spyOn(reader, 'cancel')
  fetchMock.mockResolvedValue({ ok: true, status: 200, body: { getReader: () => reader } })
  return { cancel }
}

/** 이벤트를 온 순서 그대로 문자열로 눌러 담는다 — 청크 크기가 달라도 이 배열은 같아야 한다. */
function collector() {
  const events: string[] = []
  return {
    events,
    handlers: {
      onMeta: (m: { scan_id: string }) => void events.push(`meta:${m.scan_id}`),
      onItem: (i: MenuItem) => void events.push(`item:${i.name_local}`),
    },
  }
}

const blob = () => new Blob(['fake-jpeg'], { type: 'image/jpeg' })

describe('scanMenuStream', () => {
  // 조각 경계가 어디 떨어져도 같은 결과여야 한다. size=1 이 load-bearing —
  // 객체 한가운데, 줄바꿈 직전, 멀티바이트 문자 한가운데를 전부 자른다.
  it.each([1, 3, 7, 17, 64, 4096])('emits the same events at chunk size %i', async (size) => {
    bodyOf(NDJSON, size)
    const { events, handlers } = collector()
    await scanMenuStream(blob(), handlers)
    expect(events).toEqual(['meta:scan-1', 'item:かわ', 'item:レバー'])
  })

  // 호출부가 이 값으로 최종 스캔을 완성한다(경고 배너 + 모델·지연 표시).
  it('resolves with the warnings and meta carried by the done line', async () => {
    bodyOf(NDJSON, 5)
    const tail = await scanMenuStream(blob(), collector().handlers)
    expect(tail.warnings).toEqual(DONE.warnings)
    expect(tail.meta).toEqual(DONE.meta)
  })

  // 마지막 줄에 개행이 없어도 버퍼에 남은 조각을 흘리면 안 된다(`handle(buffer)`).
  it('handles a final line that has no trailing newline', async () => {
    bodyOf(LINES.join('\n'), 9)
    const { events, handlers } = collector()
    const tail = await scanMenuStream(blob(), handlers)
    expect(events).toHaveLength(3)
    expect(tail.warnings).toEqual(DONE.warnings)
  })

  // ⚠️ 첫 바이트가 나가는 순간 HTTP 상태가 확정되므로 서버는 도중에 난 오류를 4xx/5xx 로
  //    바꿀 수 없다. 그래서 오류가 본문으로 온다 — `resp.ok` 만 보면 실패를 성공으로 읽는다.
  it('throws ApiError when the body carries an in-band error line even though HTTP is 200', async () => {
    const body = [
      LINES[0],
      LINES[1],
      JSON.stringify({ type: 'error', code: 'upstream_timeout', message: '너무 오래 걸렸어요.' }),
    ].join('\n')
    bodyOf(body, 11)
    const { events, handlers } = collector()

    const err = await scanMenuStream(blob(), handlers).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 200, code: 'upstream_timeout', message: '너무 오래 걸렸어요.' })
    // 오류 전까지 받은 항목은 유효하다 — 호출부가 살릴지 버릴지 정한다.
    expect(events).toEqual(['meta:scan-1', 'item:かわ'])
  })

  // done 없이 끊긴 스트림 = 네트워크가 도중에 죽은 경우. 조용히 성공으로 처리하면
  // 반쪽 메뉴판이 완성본인 척 저장된다.
  it('throws when the stream ends without a done line', async () => {
    bodyOf([LINES[0], LINES[1]].join('\n') + '\n', 13)
    const err = await scanMenuStream(blob(), collector().handlers).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 0, code: 'network_error' })
  })

  // 한 줄이 깨졌다고 스캔 전체를 버리지 않는다 — 나머지 줄은 멀쩡하다.
  it('skips a malformed line instead of discarding the whole scan', async () => {
    bodyOf([LINES[0], '{ not json at all', LINES[1], LINES[2], LINES[3]].join('\n') + '\n', 17)
    const { events, handlers } = collector()
    await scanMenuStream(blob(), handlers)
    expect(events).toEqual(['meta:scan-1', 'item:かわ', 'item:レバー'])
  })

  it('cancels the reader after a successful stream', async () => {
    const { cancel } = bodyOf(NDJSON, 64)
    await scanMenuStream(blob(), collector().handlers)
    expect(cancel).toHaveBeenCalled()
  })

  // ⚠️ finally 가 없으면 error 줄에서 throw 될 때 reader 가 잠긴 채 연결이 살아 있어
  //    Gemini 가 남은 항목의 출력 토큰을 계속 만든다. 취소하는 게 요점이다.
  it('cancels the reader when an in-band error aborts the stream', async () => {
    const { cancel } = bodyOf(
      [LINES[0], JSON.stringify({ type: 'error', code: 'upstream_error', message: '실패' })].join('\n'),
      64,
    )
    await expect(scanMenuStream(blob(), collector().handlers)).rejects.toThrow(ApiError)
    expect(cancel).toHaveBeenCalled()
  })

  // 스트림이 시작되기 '전에' 죽은 경우(413, 프록시 5xx 등)는 평소대로 상태가 온다.
  it("maps a non-ok response to the server's Korean message", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 413,
      json: async () => ({ code: 'file_too_large', message: '사진이 너무 커요. 다시 찍어주세요.' }),
    })
    const err = await scanMenuStream(blob(), collector().handlers).catch((e: unknown) => e)
    expect(err).toMatchObject({
      status: 413,
      code: 'file_too_large',
      message: '사진이 너무 커요. 다시 찍어주세요.',
    })
  })

  // JSON 이 아닌 응답(프록시 5xx 등)에서 파싱 오류가 사용자에게 새면 안 된다.
  it('falls back to the generic message when the error body is not JSON', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError('Unexpected token <')
      },
    })
    const err = await scanMenuStream(blob(), collector().handlers).catch((e: unknown) => e)
    expect(err).toMatchObject({ status: 502, code: 'network_error' })
  })

  // store 가 abort 를 '실패' 로 오해하면, 새 스캔을 시작하느라 끊은 낡은 요청이
  // 에러 화면을 띄운다. 취소는 실패가 아니므로 그대로 전파해야 한다.
  it('rethrows AbortError untouched so the caller can tell cancellation from failure', async () => {
    fetchMock.mockRejectedValue(new DOMException('The user aborted a request.', 'AbortError'))
    const err = await scanMenuStream(blob(), collector().handlers).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DOMException)
    expect(err).not.toBeInstanceOf(ApiError)
    expect((err as DOMException).name).toBe('AbortError')
  })

  it('wraps a network failure as ApiError(0)', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const err = await scanMenuStream(blob(), collector().handlers).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 0, code: 'network_error' })
  })

  it('throws when a 200 response has no body', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, body: null })
    const err = await scanMenuStream(blob(), collector().handlers).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
  })

  // 서버 계약: 파일 이름과 촬영 모드. 모드가 빠지면 책자형 메뉴판이 포스터 프롬프트로 돌아간다.
  it('uploads the image as menu.jpg with the capture mode', async () => {
    bodyOf(NDJSON, 64)
    await scanMenuStream(blob(), { ...collector().handlers, mode: 'booklet' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/menu/scan/stream')
    expect(init.method).toBe('POST')
    const form = init.body as FormData
    expect(form.get('mode')).toBe('booklet')
    expect((form.get('image') as File).name).toBe('menu.jpg')
  })
})

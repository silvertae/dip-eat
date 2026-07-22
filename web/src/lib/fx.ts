/** 현지 통화 → 원화 환산.
 *
 *  서버는 원화를 모른다(설계 불변식). 캐시된 스캔 결과가 과거 환율에 박제되는 걸 막으려고
 *  환산은 항상 클라이언트가, 볼 때마다 한다.
 *
 *  발표 중 이 API 가 죽어도 데모는 굴러가야 하므로 하드코딩 폴백을 둔다.
 */

const CACHE_PREFIX = 'dipeat:fx:'
const TTL_MS = 24 * 60 * 60 * 1000

/** 1 현지통화 = ? 원. 2026-07 기준 근사치 — 폴백 전용이라 정확할 필요는 없다. */
const FALLBACK: Record<string, number> = {
  JPY: 9.1,
  USD: 1380,
  EUR: 1500,
  CNY: 190,
  TWD: 43,
  HKD: 176,
  THB: 41,
  VND: 0.055,
  SGD: 1020,
  PHP: 24,
  IDR: 0.085,
  MYR: 310,
}

interface Cached {
  rate: number
  at: number
}

function read(currency: string): Cached | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + currency)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Cached
    return typeof parsed.rate === 'number' ? parsed : null
  } catch {
    return null // 사파리 프라이빗 모드 등에서 localStorage 가 던진다
  }
}

function write(currency: string, rate: number) {
  try {
    localStorage.setItem(CACHE_PREFIX + currency, JSON.stringify({ rate, at: Date.now() }))
  } catch {
    /* 저장 실패는 무시 — 다음에 다시 받아오면 된다 */
  }
}

const inflight = new Map<string, Promise<number | null>>()

async function fetchRate(currency: string): Promise<number | null> {
  try {
    const resp = await fetch(`https://open.er-api.com/v6/latest/${currency}`)
    if (!resp.ok) return null
    const body = (await resp.json()) as { rates?: Record<string, number> }
    const rate = body.rates?.KRW
    return typeof rate === 'number' && rate > 0 ? rate : null
  } catch {
    return null
  }
}

/** 즉시 쓸 수 있는 환율(캐시 또는 폴백). 모르는 통화면 null → UI 는 ₩ 를 숨긴다. */
export function rateNow(currency: string): number | null {
  if (!currency) return null
  return read(currency)?.rate ?? FALLBACK[currency] ?? null
}

/** 캐시가 없거나 하루가 지났으면 갱신한다. 실패해도 조용히 넘어간다. */
export async function refreshRate(currency: string): Promise<number | null> {
  if (!currency) return null
  const cached = read(currency)
  if (cached && Date.now() - cached.at < TTL_MS) return cached.rate

  let pending = inflight.get(currency)
  if (!pending) {
    pending = fetchRate(currency).finally(() => inflight.delete(currency))
    inflight.set(currency, pending)
  }

  const rate = await pending
  if (rate !== null) write(currency, rate)
  return rate ?? rateNow(currency)
}

export function formatKrw(amount: number): string {
  return `₩${Math.round(amount).toLocaleString('ko-KR')}`
}

/** 개별 항목은 메뉴판에 적힌 문자열(`price_text`)을 그대로 쓴다. 이건 합계처럼
 *  우리가 계산한 금액을 그릴 때만 쓴다. 모르는 통화는 코드를 그대로 붙인다. */
const SYMBOL: Record<string, string> = {
  JPY: '¥', KRW: '₩', USD: '$', EUR: '€', CNY: '¥', TWD: 'NT$',
  HKD: 'HK$', THB: '฿', VND: '₫', SGD: 'S$', PHP: '₱', MYR: 'RM',
}

export function formatLocal(amount: number, currency: string): string {
  const value = Math.round(amount).toLocaleString('en-US')
  const symbol = SYMBOL[currency]
  return symbol ? `${symbol}${value}` : `${value} ${currency}`
}

/** 현지 금액 → "₩8,800". 환율을 모르면 null. */
export function toKrw(amount: number | null | undefined, rate: number | null): string | null {
  if (amount == null || rate == null) return null
  return formatKrw(amount * rate)
}

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

/** 통화의 ISO 4217 소수 자릿수. JPY·KRW·VND=0, USD·EUR=2, **JOD·KWD·TND=3**.
 *
 *  표를 손으로 들고 있으면 썩으므로 브라우저 CLDR 에서 꺼낸다. `Intl` 은 빈 문자열이나
 *  유효하지 않은 코드에 RangeError 를 던진다(스키마상 `currency` 는 빌 수 있다). */
const MINOR_UNITS = new Map<string, number>()

function minorUnits(currency: string): number {
  const cached = MINOR_UNITS.get(currency)
  if (cached !== undefined) return cached

  let units = 2 // 모르는 코드의 무난한 기본값
  try {
    // 타입상 optional 이라 `?? units` 로 기본값을 남긴다.
    units =
      new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? units
  } catch {
    /* 유효하지 않은 통화 코드 — 기본값을 쓴다 */
  }
  MINOR_UNITS.set(currency, units)
  return units
}

/** 소수 통화($3.50 등)의 합계를 정수로 반올림하면 몇 % 가 날아간다. 그렇다고 엔·원처럼
 *  소수가 없는 통화에 `¥970.00` 을 붙일 순 없으므로, **값이 실제로 소수일 때만** 그 통화의
 *  자릿수만큼 붙인다. 자릿수를 2 로 박으면 3자리 통화(JOD 1.125)가 1.13 으로 뭉개진다.
 *
 *  경계값은 그 통화 최소 단위의 절반이다 — 그보다 작은 차이는 부동소수 누적 오차로 본다
 *  (3.5+2.8=6.300000000000001). 누적 오차는 1e-15 규모라 3자리 통화의 0.0005 와도 안 겹친다. */
export function formatLocal(amount: number, currency: string): string {
  const units = minorUnits(currency)
  const fractional = units > 0 && Math.abs(amount - Math.round(amount)) >= 0.5 * 10 ** -units
  const digits = fractional ? units : 0
  const value = amount.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
  const symbol = SYMBOL[currency]
  return symbol ? `${symbol}${value}` : `${value} ${currency}`
}

/** 현지 금액 → "₩8,800". 환율을 모르면 null. */
export function toKrw(amount: number | null | undefined, rate: number | null): string | null {
  if (amount == null || rate == null) return null
  return formatKrw(amount * rate)
}

/** 메뉴 참고 이미지 — 위키백과에서 가져온다.
 *
 *  ⚠️ 이건 **그 식당의 실제 음식 사진이 아니다.** 같은 요리의 일반적인 사진이므로
 *  UI 는 반드시 '참고'임을 표시해야 한다. (지어낸 후기를 안 만드는 것과 같은 이유)
 *
 *  ## 왜 '제목 완전일치'만 쓰는가
 *
 *  실제 메뉴명 34개로 재보니 검색 결과에 이미지가 있는 건 85% 였지만, 그중 상당수가
 *  엉뚱했다:
 *    グルクン唐揚(자리돔 튀김) → から揚げ(닭튀김)
 *    出汁巻き玉子(계란말이)   → 玉子焼(明石市) — 다른 요리
 *    てびちの煮付(족발조림)   → プレバト!!  — TV 예능
 *  부분일치도 대개 상위 개념 사진이라 다른 음식이 나온다:
 *    島らっきょうの天ぷら → 天ぷら,  納豆巻 → 納豆,  焼きおにぎり → おにぎり
 *
 *  그래서 반환된 문서 제목이 메뉴명과 **정확히 같을 때만** 채택한다. 커버리지는 절반쯤으로
 *  떨어지지만, 나머지 절반에 남의 음식 사진을 붙이는 것보다 낫다.
 */

import { useEffect, useState } from 'react'

const CACHE_PREFIX = 'dipeat:dishimg:'
const HIT_TTL = 30 * 24 * 60 * 60 * 1000
/** 못 찾은 것도 캐시한다 — 안 그러면 스크롤할 때마다 같은 실패를 다시 묻는다. */
const MISS_TTL = 7 * 24 * 60 * 60 * 1000

interface Cached {
  url: string | null
  at: number
}

function readCache(key: string): Cached | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Cached
    const ttl = parsed.url ? HIT_TTL : MISS_TTL
    return Date.now() - parsed.at < ttl ? parsed : null
  } catch {
    return null
  }
}

function writeCache(key: string, url: string | null) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ url, at: Date.now() }))
  } catch {
    /* 용량 초과·프라이빗 모드 — 캐시 실패는 무시한다 */
  }
}

const inflight = new Map<string, Promise<string | null>>()

/** 동시 요청 상한.
 *
 *  화면에 들어올 때만 부르는 IntersectionObserver 방식을 먼저 썼는데, 렌더링이 지연되는
 *  환경(백그라운드 탭 등)에서는 콜백이 아예 오지 않아 사진이 영영 안 뜬다. 렌더된 카드는
 *  그냥 다 요청하되 동시 실행만 묶는 쪽이 단순하고 환경에 덜 휘둘린다.
 *  접힌 분류는 카드를 렌더하지 않으므로 요청 수는 이미 사용자가 통제한다. */
const MAX_CONCURRENT = 4
let active = 0
const queue: (() => void)[] = []

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active += 1
    return Promise.resolve()
  }
  return new Promise((resolve) => queue.push(resolve))
}

function release() {
  const next = queue.shift()
  if (next) next()
  else active -= 1
}

async function lookup(lang: string, name: string): Promise<string | null> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*', // 익명 CORS
    prop: 'pageimages',
    piprop: 'thumbnail',
    pithumbsize: '320',
    generator: 'search',
    gsrsearch: name,
    gsrlimit: '1',
  })
  const resp = await fetch(`https://${lang}.wikipedia.org/w/api.php?${params}`)
  if (!resp.ok) return null

  const body = (await resp.json()) as {
    query?: { pages?: Record<string, { title?: string; thumbnail?: { source?: string } }> }
  }
  const page = Object.values(body.query?.pages ?? {})[0]
  if (!page?.thumbnail?.source) return null

  // 제목이 메뉴명과 정확히 같을 때만 채택한다(위 주석 참고).
  return page.title === name ? page.thumbnail.source : null
}

/** 카드가 썸네일과 상세 이미지에 같은 URL 을 쓰도록 한 곳에서 관리한다. */
export function useDishImage(name: string, lang: string): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    fetchDishImage(name, lang).then((found) => {
      if (alive) setUrl(found)
    })
    return () => {
      alive = false
    }
  }, [name, lang])
  return url
}

/** 없거나 확신이 없으면 null → 호출부는 이모지로 폴백한다. */
export async function fetchDishImage(name: string, lang: string): Promise<string | null> {
  const safeLang = /^[a-z]{2,3}$/.test(lang) ? lang : 'ja'
  const key = `${safeLang}:${name}`

  const cached = readCache(key)
  if (cached) return cached.url

  let pending = inflight.get(key)
  if (!pending) {
    pending = acquire()
      .then(() => lookup(safeLang, name))
      .catch(() => null)
      .finally(() => {
        release()
        inflight.delete(key)
      })
    inflight.set(key, pending)
  }

  const url = await pending
  writeCache(key, url)
  return url
}

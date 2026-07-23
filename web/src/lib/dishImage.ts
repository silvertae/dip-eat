/** 메뉴 참고 이미지 — 위키미디어 커먼즈에서 가져온다.
 *
 *  ⚠️ 이건 **그 식당의 실제 음식 사진이 아니다.** 같은 요리의 일반적인 사진이므로
 *  UI 는 반드시 '참고'임을 표시한다. (지어낸 후기를 안 만드는 것과 같은 이유)
 *
 *  ## 왜 커먼즈 검색인가 (위키백과 pageimages 가 아니라)
 *
 *  전에는 일본어 위키백과의 '문서 대표 이미지'만 썼다. 그러면 그 요리의 위키 문서가
 *  있어야만 사진이 나와서 厚焼き玉子·きゅうりの浅漬 같은 흔한 것도 아이콘으로 떨어졌다.
 *  커먼즈는 미디어 저장소를 직접 검색하므로 문서가 없어도 사진을 찾는다. 실측(브라우저)
 *  결과 커버리지가 크게 올랐다.
 *
 *  ## 정밀도 가드
 *
 *  커먼즈 검색은 전문(full-text) 랭킹이라 오답이 섞인다('ramen'→하늘을 나는 스파게티
 *  괴물, 'cucumber pickle'→빅맥). 그래서 **파일 제목에 쿼리 토큰이 들어있는 결과만**
 *  채택한다. 실측에서 이게 오답을 깨끗이 걸러냈다(tamagoyaki→Tamagoyaki.jpg, 이자카야
 *  전경 사진은 제외). 못 맞히면 아이콘으로 — 남의 음식을 붙이는 것보다 낫다.
 *
 *  ## 저작권 (법적 의무)
 *
 *  커먼즈 사진은 대부분 CC-BY/BY-SA 라 **저작자·라이선스 표기가 의무**다. extmetadata
 *  로 함께 받아 상세에 표시한다. Artist 필드는 HTML 이라 태그를 벗겨서 쓴다.
 */

import { useEffect, useState } from 'react'
import type { MenuItem } from '../types/api'

export interface DishImage {
  url: string
  sourceUrl: string
  author: string
  license: string
  licenseUrl: string
}

const CACHE_PREFIX = 'dipeat:dishimg:v2:'
const HIT_TTL = 30 * 24 * 60 * 60 * 1000
/** 못 찾은 것도 캐시한다 — 안 그러면 스크롤할 때마다 같은 실패를 다시 묻는다. */
const MISS_TTL = 7 * 24 * 60 * 60 * 1000

interface Cached {
  image: DishImage | null
  at: number
}

function readCache(key: string): Cached | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Cached
    const ttl = parsed.image ? HIT_TTL : MISS_TTL
    return Date.now() - parsed.at < ttl ? parsed : null
  } catch {
    return null
  }
}

function writeCache(key: string, image: DishImage | null) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ image, at: Date.now() }))
  } catch {
    /* 용량 초과·프라이빗 모드 — 캐시 실패는 무시한다 */
  }
}

// --- 정밀도 가드 -----------------------------------------------------------

/** 가타카나 → 히라가나. 'まぐろ' 와 'マグロ' 를 같게 본다. */
function kanaFold(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
}

/** 이 커먼즈 파일 제목을 이 쿼리의 사진으로 써도 되는가.
 *  - 영문 쿼리: 제목(소문자)에 쿼리 토큰(3자+)이 하나라도 들어가면 채택.
 *  - 일본어 쿼리: 가나 정규화 후 제목에 쿼리가 부분 포함되면 채택. */
function titleMatches(title: string, query: string): boolean {
  const t = title.toLowerCase()
  const asciiTokens = query
    .toLowerCase()
    .split(/[\s・,]+/)
    .filter((w) => /^[a-z]/.test(w) && w.length >= 3)
  if (asciiTokens.length > 0) return asciiTokens.some((w) => t.includes(w))

  // 영문 토큰이 없으면(일본어 쿼리) 가나 정규화 부분일치
  const q = kanaFold(query)
  return q.length >= 2 && kanaFold(title).includes(q)
}

// --- 커먼즈 호출 -----------------------------------------------------------

interface CommonsFile {
  title?: string
  imageinfo?: {
    thumburl?: string
    mime?: string
    descriptionurl?: string
    extmetadata?: Record<string, { value?: string }>
  }[]
}

/** HTML 태그를 벗겨 순수 텍스트만. Artist/Credit 필드가 '<a href=...>이름</a>' 형태다. */
function stripHtml(html: string | undefined): string {
  if (!html) return ''
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 커먼즈 Artist 필드의 상용구를 정리해 표시용 저작자 이름만 뽑는다.
 *  기계판독 저작자가 없는 파일은 'No machine-readable author provided. XXX assumed
 *  (based on copyright claims).' 형태로 온다 — 여기서 실제 사용자명 XXX 만 남긴다. */
function cleanAuthor(raw: string): string {
  const assumed = raw.match(/provided\.\s*(.+?)\s+assumed/i)
  const name = assumed ? assumed[1] : raw
  return name && !/no machine-readable/i.test(name) ? name : '위키미디어 커먼즈 기여자'
}

async function searchCommons(query: string): Promise<DishImage | null> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*', // 익명 CORS
    generator: 'search',
    gsrsearch: query,
    gsrnamespace: '6', // File: 네임스페이스(미디어)만
    gsrlimit: '6',
    prop: 'imageinfo',
    iiprop: 'url|mime|extmetadata',
    iiurlwidth: '320',
    iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist|AttributionRequired',
  })
  const resp = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`)
  if (!resp.ok) return null

  const body = (await resp.json()) as { query?: { pages?: Record<string, CommonsFile> } }
  const files = Object.values(body.query?.pages ?? {})

  for (const file of files) {
    const info = file.imageinfo?.[0]
    if (!file.title || !info?.thumburl || !/^image\//.test(info.mime ?? '')) continue
    // 제목에서 'File:' 과 확장자를 떼고 가드에 건다.
    const bareTitle = file.title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '')
    if (!titleMatches(bareTitle, query)) continue

    const meta = info.extmetadata ?? {}
    return {
      url: info.thumburl,
      sourceUrl: info.descriptionurl ?? '',
      author: cleanAuthor(stripHtml(meta.Artist?.value)),
      license: stripHtml(meta.LicenseShortName?.value) || 'CC',
      licenseUrl: meta.LicenseUrl?.value ?? '',
    }
  }
  return null
}

const inflight = new Map<string, Promise<DishImage | null>>()
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

/** 영문 검색어 → (실패 시) 원문 이름 순으로 커먼즈를 찾는다. 둘 다 없으면 아이콘. */
export async function fetchDishImage(item: MenuItem): Promise<DishImage | null> {
  const queries = [item.image_query, item.name_local].filter((q) => q && q.trim())
  if (queries.length === 0) return null
  const key = queries.join('|')

  const cached = readCache(key)
  if (cached) return cached.image

  let pending = inflight.get(key)
  if (!pending) {
    pending = acquire()
      .then(async () => {
        for (const q of queries) {
          const hit = await searchCommons(q).catch(() => null)
          if (hit) return hit
        }
        return null
      })
      .catch(() => null)
      .finally(() => {
        release()
        inflight.delete(key)
      })
    inflight.set(key, pending)
  }

  const image = await pending
  writeCache(key, image)
  return image
}

/** 카드가 썸네일과 상세 이미지에 같은 결과를 쓰도록 한 곳에서 관리한다. */
export function useDishImage(item: MenuItem): DishImage | null {
  const [image, setImage] = useState<DishImage | null>(null)
  // item 객체 대신 원시값에 의존한다(객체 참조가 바뀌어도 불필요하게 재조회하지 않도록).
  useEffect(() => {
    let alive = true
    fetchDishImage(item).then((found) => {
      if (alive) setImage(found)
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.image_query, item.name_local])
  return image
}

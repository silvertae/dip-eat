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
 *  괴물, 'cucumber pickle'→빅맥). 그래서 **파일 제목에 쿼리의 핵심 단어가 전부 있는 결과만**
 *  채택하고, 한 단어 쿼리는 음식이라는 증거(요리 어휘)까지 요구한다 — 'Kamo'(合鴨) 가 인물
 *  사진을 고른 이슈 #32 참고(`isSafeCandidate`). 못 맞히면 아이콘으로 — 남의 음식을 붙이는
 *  것보다 낫다.
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

/** v3: 가드 강화(이슈 #32). v2 에는 'Kamo' → 인물 사진 같은 오답 hit 가 30일 박제돼 있다. */
const CACHE_PREFIX = 'dipeat:dishimg:v3:'
const STALE_PREFIXES = ['dipeat:dishimg:v1:', 'dipeat:dishimg:v2:']
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

/** 옛 버전 캐시 키를 지운다. 부팅 시 1회(main.tsx). 안 지우면 오답이 남는 건 아니지만
 *  (prefix 가 달라 안 읽힌다) iOS 의 5MB localStorage 를 계속 차지한다. */
export function purgeStaleDishImageCache() {
  try {
    const stale: string[] = []
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (key && STALE_PREFIXES.some((p) => key.startsWith(p))) stale.push(key)
    }
    stale.forEach((key) => localStorage.removeItem(key))
  } catch {
    /* 프라이빗 모드 등 — 무시 */
  }
}

// --- 정밀도 가드 -----------------------------------------------------------
//
// ⚠️ 이슈 #32: `image_query: "Kamo"`(合鴨) 가 볼셰비키 혁명가 사진 `Kamo(Ter-Petrossian).jpg`
// 를 골랐다. 예전 가드는 "쿼리 토큰 하나가 제목의 **부분 문자열**이면 통과" 였다.
// 실측해 보니 그 인물 사진의 카테고리(`Kamo|PD-Russia-1996|…`)에도 '사람' 이라는 신호가
// 없다 — 즉 **비음식을 골라내는 것만으로는 못 막는다.** 그래서 한 단어짜리 쿼리(가장
// 모호한 경우)에는 **음식이라는 긍정 증거**를 요구한다. 정상 음식 사진도 카테고리에
// 'food' 같은 일반어가 거의 없고 'Ramen'·'Okinawa soba' 처럼 요리명만 달려 있어서,
// 증거는 요리 어휘 사전과 단어 단위로 대조한다. 사전에 없는 한 단어 요리명은 아이콘으로
// 떨어지는데, 그게 맞다 — 남의 얼굴을 음식이라고 보여주는 것보다 낫다.

/** 가타카나 → 히라가나. 'まぐろ' 와 'マグロ' 를 같게 본다. */
function kanaFold(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
}

/** 소문자 + 발음기호 제거('Gōyā Chanpurū' → 'goya chanpuru') + 구분자를 공백으로. */
function normalize(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_\-()[\],.・'"/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 단어 단위 포함. 'kamo' 는 'kamo ter petrossian' 에는 있지만 'kamoshika' 에는 없다. */
function hasWord(haystack: string, word: string): boolean {
  return ` ${haystack} `.includes(` ${word} `)
}

/** 토큰이 제목에 있는가. 'Tamago yaki' 처럼 띄어 쓴 제목도 'tamagoyaki' 로 잡는다. */
function titleHasToken(title: string, token: string): boolean {
  return hasWord(title, token) || hasWord(title.replace(/ /g, ''), token)
}

/** 조리법·수식어 — '모든 토큰 일치' 를 요구할 때 빼는 말. 핵심 명사만 남긴다. */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'of', 'with', 'in', 'on', 'the', 'style', 'japanese',
  'fried', 'deep', 'grilled', 'boiled', 'steamed', 'simmered', 'stewed', 'raw',
  'roasted', 'braised', 'pickled', 'seared', 'sauteed', 'stir',
])

/** 조리법 단어 — 제목에 있으면 음식 사진이라는 증거도 된다('Fried Gurukun'). */
const STOPWORDS_COOKING = new Set([...STOPWORDS].filter((w) => w.length > 3 && !['with', 'style', 'japanese'].includes(w)))

/** 이 말이 제목·카테고리에 단어로 있으면 음식 사진이라고 본다(한 단어 쿼리 전용 증거). */
const FOOD_WORDS = new Set([
  'food', 'foods', 'cuisine', 'dish', 'dishes', 'meal', 'meals', 'snack', 'snacks',
  'dessert', 'desserts', 'cake', 'cakes', 'sweets', 'confectionery', 'bread',
  'drink', 'drinks', 'beverage', 'beverages', 'beer', 'sake', 'shochu', 'awamori', 'wine', 'tea', 'coffee',
  'sushi', 'sashimi', 'nigiri', 'maki', 'ramen', 'soba', 'udon', 'noodle', 'noodles', 'pasta',
  'yakitori', 'kushiyaki', 'kushikatsu', 'tempura', 'karaage', 'tonkatsu', 'katsu', 'donburi', 'don',
  'yaki', 'nabe', 'oden', 'gyoza', 'dumpling', 'dumplings', 'onigiri', 'bento', 'curry', 'rice',
  'soup', 'stew', 'salad', 'skewer', 'skewers', 'kebab', 'tofu', 'miso', 'natto', 'tsukemono', 'pickles',
  'champuru', 'chanpuru', 'okonomiyaki', 'takoyaki', 'tamagoyaki', 'teppanyaki', 'sukiyaki', 'shabu',
  'yakiniku', 'gyudon', 'katsudon', 'oyakodon', 'edamame', 'mochi', 'dango', 'wagashi', 'taiyaki',
  'pho', 'banh', 'bun', 'kimchi', 'bibimbap', 'bulgogi', 'tteokbokki', 'dim', 'sum', 'baozi',
  'pizza', 'burger', 'sandwich', 'steak', 'taco', 'tacos',
  // 오키나와 요리 — 커먼즈 카테고리가 요리명 하나뿐이라('Rafute') 사전에 없으면 전부 아이콘이 된다.
  // ⚠️ 'goya'(화가 고야)·'soki' 처럼 다른 뜻과 겹치는 말은 넣지 말 것 — 한 단어 쿼리의 증거가 된다.
  'rafute', 'rafuti', 'mimiga', 'jimami', 'andagi', 'umibudo', 'tebichi', 'mozuku', 'gurukun',
  'nakami', 'juushii', 'asazuke',
  'egg', 'eggs', 'meat', 'pork', 'beef', 'chicken', 'duck', 'fish', 'seafood', 'shrimp', 'prawn',
  'squid', 'octopus', 'crab', 'oyster', 'oysters', 'eel', 'tuna', 'salmon', 'vegetable', 'vegetables',
])

/** 제목·카테고리에 이 패턴이 있으면 음식 사진이 아니다(인물·지명·우표·문장 등).
 *  카테고리 'Restaurants in …' 은 넣지 않는다 — 식당에서 찍은 정상 요리 사진에도 붙는다
 *  (예: 'Goya Champuru at Yumenoya.jpg'). 대신 **제목**의 'restaurant' 는 외관 사진이다. */
const NON_FOOD_CATEGORY = [
  /\bpeople\b/, /\bpersons?\b/, /\bportraits?\b/, /\bbirths\b/, /\bdeaths\b/,
  /\bpoliticians?\b/, /\brevolutionar/, /\bbolshevik/, /\bstamps?\b/, /\bemblems?\b/,
  /\bcoats? of arms\b/, /\bmunicipalit/, /\baerial\b/, /\bgeography of\b/, /\bmaps?\b/,
  /\blogos?\b/, /\bbuildings?\b/,
]
const NON_FOOD_TITLE = [/\brestaurants?\b/, /\bportrait\b/, /\bstamp\b/, /\bemblem\b/, /\bmap\b/]

export interface Candidate {
  /** 'File:' 과 확장자를 뗀 제목 */
  title: string
  /** 커먼즈 extmetadata.Categories (파이프 구분) */
  categories: string
}

/** 이 커먼즈 파일을 이 쿼리의 참고 사진으로 써도 되는가.
 *  - 영문 쿼리: 핵심 토큰이 **전부** 제목에 단어로 있어야 한다. 한 단어 쿼리는 추가로
 *    제목·카테고리에 음식 어휘가 있어야 한다. 비음식 신호가 있으면 무조건 거절.
 *  - 일본어 쿼리: 가나 정규화 후 제목에 쿼리가 부분 포함되면 채택(원문 제목은 오답이 드물다). */
export function isSafeCandidate({ title, categories }: Candidate, query: string): boolean {
  const asciiTokens = normalize(query)
    .split(' ')
    .filter((w) => /^[a-z]/.test(w) && w.length >= 3)

  if (asciiTokens.length === 0) {
    const q = kanaFold(query.trim())
    return q.length >= 2 && kanaFold(title).includes(q)
  }

  const t = normalize(title)
  const cats = categories.split('|').map(normalize)
  if (NON_FOOD_TITLE.some((re) => re.test(t))) return false
  if (cats.some((c) => NON_FOOD_CATEGORY.some((re) => re.test(c)))) return false

  // 고유한 말(gurukun·champuru)은 반드시 제목에 있어야 한다. 'fish'·'yakitori' 같은 일반
  // 음식어는 제목에 없어도 된다 — 'Fried Gurukun at Yumenoya.jpg' 는 'gurukun fried fish' 의 정답이다.
  const core = asciiTokens.filter((w) => !STOPWORDS.has(w))
  const distinctive = core.filter((w) => !FOOD_WORDS.has(w))
  const required = distinctive.length > 0 ? distinctive : core.length > 0 ? core : asciiTokens
  if (!required.every((w) => titleHasToken(t, w))) return false

  // 쿼리 단어가 둘 이상 제목에 맞았으면 우연일 확률이 낮다. 하나뿐이면 'Kamo' 처럼 인명·지명과
  // 겹칠 수 있으니 제목·카테고리에서 음식이라는 증거를 따로 찾는다.
  const matched = asciiTokens.filter((w) => titleHasToken(t, w)).length
  if (matched >= 2) return true
  const evidence = [t, ...cats].flatMap((s) => s.split(' '))
  return evidence.some((w) => FOOD_WORDS.has(w) || STOPWORDS_COOKING.has(w))
}

// --- 커먼즈 호출 -----------------------------------------------------------

interface CommonsFile {
  title?: string
  /** 검색 관련도 순위(1부터). pages 는 page ID 키 객체라 이걸로 다시 정렬해야 한다. */
  index?: number
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

export async function searchCommons(query: string): Promise<DishImage | null> {
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
    iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist|AttributionRequired|Categories',
  })
  const resp = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`)
  // 일시적 오류(429·5xx)는 '못 찾음'이 아니다 — 던져서 miss 로 캐시되지 않게 한다.
  if (!resp.ok) throw new Error(`commons ${resp.status}`)

  const body = (await resp.json()) as { query?: { pages?: Record<string, CommonsFile> } }
  // ⚠️ pages 는 page ID(정수) 키 객체라 Object.values 는 **page ID 순**으로 열거한다 —
  //    커먼즈의 관련도 순위가 사라진다(이슈 #32). index 로 되돌린다.
  const files = Object.values(body.query?.pages ?? {}).sort(
    (a, b) => (a.index ?? Number.MAX_SAFE_INTEGER) - (b.index ?? Number.MAX_SAFE_INTEGER),
  )

  for (const file of files) {
    const info = file.imageinfo?.[0]
    if (!file.title || !info?.thumburl || !/^image\//.test(info.mime ?? '')) continue
    // 제목에서 'File:' 과 확장자를 떼고 가드에 건다.
    const bareTitle = file.title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '')
    const meta = info.extmetadata ?? {}
    if (!isSafeCandidate({ title: bareTitle, categories: meta.Categories?.value ?? '' }, query)) continue

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

/** failed=true 는 네트워크/서버 오류(오프라인 포함) — 캐시하지 않고 다음에 다시 시도한다.
 *  failed=false + image=null 은 '진짜 못 찾음' — miss 로 캐시해 반복 조회를 막는다. */
type Lookup = { image: DishImage | null; failed: boolean }

const inflight = new Map<string, Promise<Lookup>>()
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
      .then<Lookup>(async () => {
        // query 마다 오류를 격리한다 — image_query 가 일시 오류여도 원문명(name_local)으로 넘어가 본다.
        let sawError = false
        for (const q of queries) {
          try {
            const hit = await searchCommons(q)
            if (hit) return { image: hit, failed: false }
          } catch {
            sawError = true // 네트워크·429·5xx — 다음 query 시도
          }
        }
        // 하나라도 오류가 있었으면 '진짜 못 찾음'이 아니다 → miss 로 캐시하지 않고 다음에 재시도.
        return { image: null, failed: sawError }
      })
      .catch<Lookup>(() => ({ image: null, failed: true })) // 예기치 못한 오류도 캐시하지 않는다
      .finally(() => {
        release()
        inflight.delete(key)
      })
    inflight.set(key, pending)
  }

  const { image, failed } = await pending
  if (!failed) writeCache(key, image)
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

/** 참고 이미지 정밀도 가드 — 이슈 #32 회귀.
 *
 *  `image_query: "Kamo"`(合鴨) 가 볼셰비키 혁명가 사진 `Kamo(Ter-Petrossian).jpg` 를 골랐다.
 *  원인이 셋 겹쳐 있었다: 부분 문자열 매칭 · page ID 순 순회(관련도 순위 유실) · 한 단어
 *  쿼리에 음식 증거를 안 봄. 아래 커먼즈 응답 픽스처는 2026-11-21 실제 응답을 줄인 것이다.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchDishImage, isSafeCandidate, purgeStaleDishImageCache, searchCommons } from './dishImage'
import type { MenuItem } from '../types/api'

const fetchMock = vi.fn()

beforeEach(() => {
  localStorage.clear()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

interface Page {
  pageid: number
  index: number
  title: string
  categories: string
}

function commonsResponse(pages: Page[]) {
  return new Response(
    JSON.stringify({
      query: {
        pages: Object.fromEntries(
          pages.map((p) => [
            String(p.pageid),
            {
              pageid: p.pageid,
              index: p.index,
              title: p.title,
              imageinfo: [
                {
                  thumburl: `https://upload.wikimedia.org/${p.pageid}.jpg`,
                  mime: 'image/jpeg',
                  descriptionurl: `https://commons.wikimedia.org/wiki/${p.title}`,
                  extmetadata: {
                    Categories: { value: p.categories },
                    LicenseShortName: { value: 'CC BY-SA 4.0' },
                    Artist: { value: '<a href="x">someone</a>' },
                  },
                },
              ],
            },
          ]),
        ),
      },
    }),
    { status: 200 },
  )
}

const empty = () => new Response(JSON.stringify({}), { status: 200 })

// 실제 'Kamo' 검색 결과(2026-11-21). 인물 사진(index 2)의 page ID 가 식당 사진(index 1)보다 작다.
const KAMO_PAGES: Page[] = [
  { pageid: 80486015, index: 1, title: 'File:KAMO (restaurant).jpg', categories: 'Sashimi|Kamo (restaurant)|Self-published work|Restaurants in Ixelles' },
  { pageid: 7577765, index: 2, title: 'File:Kamo(Ter-Petrossian).jpg', categories: 'Kamo|PD-Russia-1996|PD US expired|Template Unknown (author)' },
  { pageid: 40052508, index: 3, title: 'File:The Soviet Union 1972 CPA 4090 stamp (Kamo).jpg', categories: 'Kamo|1972 all stamps of the Soviet Union|PD-RU-exempt (stamps)' },
  { pageid: 116003294, index: 4, title: 'File:Emblem of Kamo, Niigata.svg', categories: 'Emblems|Kamo, Niigata' },
  { pageid: 47014498, index: 6, title: 'File:Kamo 10.jpg', categories: 'Kamo|PD US|Template Unknown (author)' },
]

function menuItem(image_query: string, name_local: string): MenuItem {
  return {
    name_local,
    name_translated: '',
    price_text: '',
    price_amount: null,
    tax_included: null,
    category: 'food',
    section: '',
    summary: '',
    image_query,
    tags: [],
    allergens: [],
    ocr_confidence: 'high',
  }
}

describe('isSafeCandidate', () => {
  it('rejects the person photo for an ambiguous one-word query (#32)', () => {
    expect(
      isSafeCandidate({ title: 'Kamo(Ter-Petrossian)', categories: 'Kamo|PD-Russia-1996|PD US expired' }, 'Kamo'),
    ).toBe(false)
  })

  it('rejects restaurant exteriors, stamps and emblems even when the title matches', () => {
    for (const p of KAMO_PAGES) {
      const title = p.title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '')
      expect(isSafeCandidate({ title, categories: p.categories }, 'Kamo')).toBe(false)
    }
  })

  it('accepts a real dish photo for a one-word dish query', () => {
    expect(isSafeCandidate({ title: 'Tamagoyaki', categories: 'GFDL|Akashiyaki' }, 'tamagoyaki')).toBe(true)
    expect(isSafeCandidate({ title: 'Tamago yaki', categories: 'GFDL|Tamago yaki' }, 'tamagoyaki')).toBe(true)
    expect(isSafeCandidate({ title: 'Ramen 4', categories: 'Ramen|Self-published work' }, 'ramen')).toBe(true)
    expect(isSafeCandidate({ title: 'Rafute - Tora Taverna Japonesa', categories: 'Rafute' }, 'rafute')).toBe(true)
  })

  it('does not treat an ambiguous word like goya as food evidence', () => {
    expect(isSafeCandidate({ title: 'Goya - Self portrait', categories: 'Paintings by Francisco Goya' }, 'goya')).toBe(false)
  })

  it('matches whole words, not substrings', () => {
    expect(isSafeCandidate({ title: 'Kamoshika dish', categories: 'Japanese cuisine' }, 'kamo')).toBe(false)
  })

  it('requires every core token of a multi-word query', () => {
    expect(isSafeCandidate({ title: 'Duck Hunt', categories: 'Video games' }, 'duck yakitori')).toBe(false)
    expect(isSafeCandidate({ title: 'Duck yakitori at Torikizoku', categories: 'Yakitori' }, 'duck yakitori')).toBe(true)
    // 조리법 단어(fried)는 제목에 없어도 된다
    expect(isSafeCandidate({ title: 'Gurukun fish', categories: '' }, 'gurukun fried fish')).toBe(true)
  })

  it('folds diacritics so Gōyā Chanpurū style titles still match', () => {
    expect(isSafeCandidate({ title: 'Gōyā Chanpurū', categories: 'Tofu dishes of Japan' }, 'goya chanpuru')).toBe(true)
  })

  it('keeps a dish photo taken inside a restaurant (category, not title)', () => {
    expect(
      isSafeCandidate(
        { title: 'Goya Champuru at Yumenoya', categories: 'Tofu dishes of Japan|Restaurants in Okinawa prefecture' },
        'goya champuru',
      ),
    ).toBe(true)
  })

  it('keeps the kana-folded substring rule for Japanese queries', () => {
    expect(isSafeCandidate({ title: 'まぐろ刺身', categories: '' }, 'マグロ')).toBe(true)
    expect(isSafeCandidate({ title: '鶏皮', categories: '' }, '合鴨')).toBe(false)
  })
})

describe('searchCommons', () => {
  it('walks results in relevance (index) order, not page ID order', async () => {
    fetchMock.mockResolvedValue(
      commonsResponse([
        // page ID 가 작은 쪽이 index 는 뒤다 — Object.values 그대로면 이게 먼저 채택된다.
        { pageid: 100, index: 2, title: 'File:Okinawa soba 2.jpg', categories: 'Okinawa soba' },
        { pageid: 900, index: 1, title: 'File:Okinawa soba in Yamabare.jpg', categories: 'Okinawa soba' },
      ]),
    )
    const hit = await searchCommons('okinawa soba')
    expect(hit?.url).toBe('https://upload.wikimedia.org/900.jpg')
  })

  it('asks Commons for categories', async () => {
    fetchMock.mockResolvedValue(empty())
    await searchCommons('ramen')
    expect(String(fetchMock.mock.calls[0][0])).toContain('Categories')
  })

  it('returns null for the real Kamo result set', async () => {
    fetchMock.mockResolvedValue(commonsResponse(KAMO_PAGES))
    expect(await searchCommons('Kamo')).toBeNull()
  })
})

describe('fetchDishImage', () => {
  it('falls back to name_local when image_query has no safe candidate', async () => {
    fetchMock
      .mockResolvedValueOnce(commonsResponse(KAMO_PAGES))
      .mockResolvedValueOnce(
        commonsResponse([{ pageid: 5, index: 1, title: 'File:合鴨ロース.jpg', categories: 'Duck dishes' }]),
      )
    const hit = await fetchDishImage(menuItem('Kamo', '合鴨'))
    expect(hit?.url).toBe('https://upload.wikimedia.org/5.jpg')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('returns null (icon) and caches the miss when nothing is safe', async () => {
    fetchMock.mockResolvedValueOnce(commonsResponse(KAMO_PAGES)).mockResolvedValueOnce(empty())
    expect(await fetchDishImage(menuItem('Kamo', '合鴨串'))).toBeNull()
    expect(await fetchDishImage(menuItem('Kamo', '合鴨串'))).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2) // 두 번째는 miss 캐시
  })

  it('ignores a poisoned v2 cache entry', async () => {
    localStorage.setItem(
      'dipeat:dishimg:v2:Kamo|合鴨焼',
      JSON.stringify({ image: { url: 'https://bad/person.jpg' }, at: Date.now() }),
    )
    fetchMock.mockResolvedValue(empty())
    expect(await fetchDishImage(menuItem('Kamo', '合鴨焼'))).toBeNull()
  })
})

describe('purgeStaleDishImageCache', () => {
  it('removes old-version keys and keeps current ones and unrelated keys', () => {
    localStorage.setItem('dipeat:dishimg:v2:a', '1')
    localStorage.setItem('dipeat:dishimg:v2:b', '1')
    localStorage.setItem('dipeat:dishimg:v3:c', '1')
    localStorage.setItem('dipeat:session', '1')
    purgeStaleDishImageCache()
    expect(localStorage.getItem('dipeat:dishimg:v2:a')).toBeNull()
    expect(localStorage.getItem('dipeat:dishimg:v2:b')).toBeNull()
    expect(localStorage.getItem('dipeat:dishimg:v3:c')).toBe('1')
    expect(localStorage.getItem('dipeat:session')).toBe('1')
  })
})

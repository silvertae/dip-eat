import { describe, expect, it } from 'vitest'
import { buildOrderCard, quickPhrases } from './orderPhrases'

describe('offline order phrases', () => {
  it('keeps the Korean traveler to Japanese staff flow', () => {
    const card = buildOrderCard([], 'ja', ['cilantro'], 'ko')
    expect(card.intro?.local).toContain('注文')
    expect(card.memos[0]).toMatchObject({
      local: 'パクチー抜きでお願いします',
      ko: '고수(파쿠치) 빼주세요',
    })
  })

  it('supports a Japanese traveler speaking to Korean staff', () => {
    const card = buildOrderCard([], 'ko', ['cilantro'], 'ja')
    expect(card.intro).toEqual({
      local: '저기요, 주문할게요',
      reading: 'チョギヨ、チュムンハルケヨ',
    })
    expect(card.memos[0]).toEqual({
      local: '고수 빼주세요',
      ko: 'パクチーを抜いてください',
    })
    expect(quickPhrases('ja', 'ko')[0]).toEqual({
      ko: 'これをください',
      local: '이거 주세요',
      reading: 'イゴ ジュセヨ',
    })
  })

  it('does not invent offline phrases for unsupported pairs', () => {
    expect(quickPhrases('ja', 'th')).toEqual([])
    expect(buildOrderCard([], 'th', [], 'ja').intro).toBeNull()
  })
})

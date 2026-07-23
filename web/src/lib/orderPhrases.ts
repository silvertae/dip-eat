import { cartTotals, type CartLine } from './cart'
import { DISLIKE_CHOICES } from './profileOptions'

/** 주문 '카드'는 서버를 부르지 않는다 — 오프라인에서도 점원에게 보여줘야 하므로 클라이언트가
 *  정적 문구 테이블로 조립한다. 일본어를 먼저 채우고, 없는 언어는 우아하게 폴백한다.
 *
 *  (자유 발화는 /chat 이 언어 무관으로 번역한다. 여기 테이블은 오프라인용 고정 문구뿐이다.) */
interface LangPhrases {
  /** "저기요, 주문할게요" — 점원이 읽을 현지어 */
  orderIntro: string
  orderIntroReading: string
  /** "{재료}빼고 주세요" 의 접미. 비선호 재료 뒤에 붙인다. */
  omitSuffix: string
  /** 비선호 key → 현지어 재료명 */
  ingredient: Record<string, string>
}

const PHRASES: Record<string, LangPhrases> = {
  ja: {
    orderIntro: 'すみません、注文お願いします',
    orderIntroReading: '스미마셍, 추-몬 오네가이시마스',
    omitSuffix: '抜きでお願いします',
    ingredient: Object.fromEntries(DISLIKE_CHOICES.map((d) => [d.key, d.ja])),
  },
}

export interface OrderCard {
  /** 점원에게 보여줄 현지어 인사. 지원 안 하는 언어면 null → UI 는 한국어만 + 안내. */
  intro: { local: string; reading: string } | null
  /** name_local × qty. 메뉴 이름은 이미 현지어라 번역 불필요. */
  lines: { nameLocal: string; nameKo: string; qty: number }[]
  /** 비선호 자동 메모. 지원 안 하는 언어면 빈 배열. */
  memos: { local: string; ko: string }[]
  count: number
  localTotal: number
  missingPrice: number
}

export function buildOrderCard(
  cartLines: CartLine[],
  sourceLang: string,
  dislikes: string[],
): OrderCard {
  const p = PHRASES[sourceLang]
  const totals = cartTotals(cartLines)

  const memos = p
    ? dislikes
        .filter((key) => p.ingredient[key])
        .map((key) => {
          const ko = DISLIKE_CHOICES.find((d) => d.key === key)?.label ?? key
          return { local: `${p.ingredient[key]}${p.omitSuffix}`, ko: `${ko} 빼주세요` }
        })
    : []

  return {
    intro: p ? { local: p.orderIntro, reading: p.orderIntroReading } : null,
    lines: cartLines.map((l) => ({
      nameLocal: l.item.name_local,
      nameKo: l.item.name_translated,
      qty: l.qty,
    })),
    memos,
    count: totals.count,
    localTotal: totals.localTotal,
    missingPrice: totals.missingPrice,
  }
}

export const orderCardSupported = (sourceLang: string) => sourceLang in PHRASES

/** 대화의 빠른 응답 칩. 미리 번역돼 있어 오프라인에서도 점원에게 보여줄 수 있다.
 *  일본어만 채우고, 없는 언어는 UI 가 이 칩을 숨긴다. */
export interface QuickPhrase {
  ko: string
  byLang: Record<string, { local: string; reading: string }>
}

export const QUICK_PHRASES: QuickPhrase[] = [
  { ko: '이거 주세요', byLang: { ja: { local: 'これください', reading: '코레 쿠다사이' } } },
  { ko: '추천해주세요', byLang: { ja: { local: 'おすすめは？', reading: '오스스메와?' } } },
  { ko: '이거 맵나요?', byLang: { ja: { local: 'これは辛いですか？', reading: '코레와 카라이데스카?' } } },
  { ko: '얼마예요?', byLang: { ja: { local: 'おいくらですか？', reading: '오이쿠라데스카?' } } },
  { ko: '계산해주세요', byLang: { ja: { local: 'お会計お願いします', reading: '오카이케- 오네가이시마스' } } },
]

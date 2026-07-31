import { cartTotals, type CartLine } from './cart'
import { DISLIKE_CHOICES } from './profileOptions'
import type { TravelerLang } from '../types/locale'

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

const PHRASES: Partial<Record<TravelerLang, Record<string, LangPhrases>>> = {
  ko: {
    ja: {
      orderIntro: 'すみません、注文お願いします',
      orderIntroReading: '스미마셍, 추-몬 오네가이시마스',
      omitSuffix: '抜きでお願いします',
      ingredient: Object.fromEntries(DISLIKE_CHOICES.map((d) => [d.key, d.local.ja])),
    },
  },
  ja: {
    ko: {
      orderIntro: '저기요, 주문할게요',
      orderIntroReading: 'チョギヨ、チュムンハルケヨ',
      omitSuffix: ' 빼주세요',
      ingredient: Object.fromEntries(DISLIKE_CHOICES.map((d) => [d.key, d.local.ko])),
    },
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
  travelerLang: TravelerLang = 'ko',
): OrderCard {
  const p = PHRASES[travelerLang]?.[sourceLang]
  const totals = cartTotals(cartLines)

  const memos = p
    ? dislikes
        .filter((key) => p.ingredient[key])
        .map((key) => {
          const label = DISLIKE_CHOICES.find((d) => d.key === key)?.label[travelerLang] ?? key
          const traveler =
            travelerLang === 'ja' ? `${label}を抜いてください` : `${label} 빼주세요`
          return { local: `${p.ingredient[key]}${p.omitSuffix}`, ko: traveler }
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

export const orderCardSupported = (sourceLang: string, travelerLang: TravelerLang = 'ko') =>
  sourceLang in (PHRASES[travelerLang] ?? {})

/** 대화의 빠른 응답 칩. 미리 번역돼 있어 오프라인에서도 점원에게 보여줄 수 있다.
 *  일본어만 채우고, 없는 언어는 UI 가 이 칩을 숨긴다. */
export interface QuickPhrase {
  ko: string
  local: string
  reading: string
}

const KO_TO_JA: QuickPhrase[] = [
  { ko: '이거 주세요', local: 'これください', reading: '코레 쿠다사이' },
  { ko: '추천해주세요', local: 'おすすめは？', reading: '오스스메와?' },
  { ko: '이거 맵나요?', local: 'これは辛いですか？', reading: '코레와 카라이데스카?' },
  { ko: '얼마예요?', local: 'おいくらですか？', reading: '오이쿠라데스카?' },
  { ko: '계산해주세요', local: 'お会計お願いします', reading: '오카이케- 오네가이시마스' },
]

const JA_TO_KO: QuickPhrase[] = [
  { ko: 'これをください', local: '이거 주세요', reading: 'イゴ ジュセヨ' },
  { ko: 'おすすめを教えてください', local: '추천해주세요', reading: 'チュチョネジュセヨ' },
  { ko: 'これは辛いですか？', local: '이거 매워요?', reading: 'イゴ メウォヨ？' },
  { ko: 'いくらですか？', local: '얼마예요?', reading: 'オルマエヨ？' },
  { ko: 'お会計をお願いします', local: '계산해주세요', reading: 'ケサネジュセヨ' },
]

export function quickPhrases(
  travelerLang: TravelerLang,
  sourceLang: string,
): QuickPhrase[] {
  if (travelerLang === 'ko' && sourceLang === 'ja') return KO_TO_JA
  if (travelerLang === 'ja' && sourceLang === 'ko') return JA_TO_KO
  return []
}

import type { AllergenCode } from '../types/api'
import type { LocalizedText } from './i18n'
import type { TravelerLang } from '../types/locale'

/** 온보딩·설정에 노출할 알레르기 칩.
 *  스키마의 코드는 29종이지만 전부 보여주면 고를 수가 없다. 한국 식약처 표시대상 중
 *  여행지에서 실제로 자주 부딪히는 것만 골랐다. */
export const ALLERGY_CHOICES: { code: AllergenCode; label: LocalizedText }[] = [
  { code: 'shrimp', label: { ko: '🦐 새우', ja: '🦐 えび' } },
  { code: 'crustacean', label: { ko: '갑각류', ja: '甲殻類' } },
  { code: 'shellfish', label: { ko: '조개류', ja: '貝類' } },
  { code: 'fish', label: { ko: '생선', ja: '魚' } },
  { code: 'peanut', label: { ko: '땅콩', ja: '落花生' } },
  { code: 'tree_nut', label: { ko: '견과류', ja: 'ナッツ類' } },
  { code: 'egg', label: { ko: '계란', ja: '卵' } },
  { code: 'milk', label: { ko: '우유', ja: '乳' } },
  { code: 'buckwheat', label: { ko: '메밀', ja: 'そば' } },
  { code: 'wheat', label: { ko: '밀', ja: '小麦' } },
  { code: 'soy', label: { ko: '대두', ja: '大豆' } },
  { code: 'sesame', label: { ko: '참깨', ja: 'ごま' } },
  { code: 'pork', label: { ko: '돼지고기', ja: '豚肉' } },
  { code: 'beef', label: { ko: '쇠고기', ja: '牛肉' } },
  { code: 'chicken', label: { ko: '닭고기', ja: '鶏肉' } },
]

/** 비선호 선택지.
 *
 *  자유 입력(목업의 "＋ 추가")을 넣지 않은 이유: 이 값은 Phase 4 에서 주문 카드의
 *  "고수 빼주세요" 문장으로 번역돼 점원에게 보여진다. 임의의 한국어를 현지어로 옮기려면
 *  호출이 하나 더 늘고 오역 위험도 생긴다. 미리 번역을 확정해둔 목록이 훨씬 안전하다.
 *  (`ja` 는 그때 쓰려고 지금 같이 적어둔다) */
export const DISLIKE_CHOICES: {
  key: string
  label: LocalizedText
  local: { ko: string; ja: string }
}[] = [
  { key: 'cilantro', label: { ko: '고수(파쿠치)', ja: 'パクチー' }, local: { ko: '고수', ja: 'パクチー' } },
  { key: 'lamb', label: { ko: '양고기', ja: 'ラム肉' }, local: { ko: '양고기', ja: 'ラム肉' } },
  { key: 'olive', label: { ko: '올리브', ja: 'オリーブ' }, local: { ko: '올리브', ja: 'オリーブ' } },
  { key: 'blue_cheese', label: { ko: '블루치즈', ja: 'ブルーチーズ' }, local: { ko: '블루치즈', ja: 'ブルーチーズ' } },
  { key: 'natto', label: { ko: '낫토', ja: '納豆' }, local: { ko: '낫토', ja: '納豆' } },
  { key: 'wasabi', label: { ko: '고추냉이', ja: 'わさび' }, local: { ko: '고추냉이', ja: 'わさび' } },
  { key: 'raw_fish', label: { ko: '날생선', ja: '生魚' }, local: { ko: '날생선', ja: '生魚' } },
  { key: 'innards', label: { ko: '내장', ja: '内臓' }, local: { ko: '내장', ja: 'モツ' } },
]

export const allergyChoiceLabel = (code: AllergenCode, lang: TravelerLang) =>
  ALLERGY_CHOICES.find((choice) => choice.code === code)?.label[lang] ?? code

export const dislikeLabel = (key: string, lang: TravelerLang = 'ko') =>
  DISLIKE_CHOICES.find((choice) => choice.key === key)?.label[lang] ?? key

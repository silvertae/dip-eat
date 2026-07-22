import type { AllergenCode } from '../types/api'

/** 온보딩·설정에 노출할 알레르기 칩.
 *  스키마의 코드는 29종이지만 전부 보여주면 고를 수가 없다. 한국 식약처 표시대상 중
 *  여행지에서 실제로 자주 부딪히는 것만 골랐다. */
export const ALLERGY_CHOICES: { code: AllergenCode; label: string }[] = [
  { code: 'shrimp', label: '🦐 새우' },
  { code: 'crustacean', label: '갑각류' },
  { code: 'shellfish', label: '조개류' },
  { code: 'fish', label: '생선' },
  { code: 'peanut', label: '땅콩' },
  { code: 'tree_nut', label: '견과류' },
  { code: 'egg', label: '계란' },
  { code: 'milk', label: '우유' },
  { code: 'buckwheat', label: '메밀' },
  { code: 'wheat', label: '밀' },
  { code: 'soy', label: '대두' },
  { code: 'sesame', label: '참깨' },
  { code: 'pork', label: '돼지고기' },
  { code: 'beef', label: '쇠고기' },
  { code: 'chicken', label: '닭고기' },
]

/** 비선호 선택지.
 *
 *  자유 입력(목업의 "＋ 추가")을 넣지 않은 이유: 이 값은 Phase 4 에서 주문 카드의
 *  "고수 빼주세요" 문장으로 번역돼 점원에게 보여진다. 임의의 한국어를 현지어로 옮기려면
 *  호출이 하나 더 늘고 오역 위험도 생긴다. 미리 번역을 확정해둔 목록이 훨씬 안전하다.
 *  (`ja` 는 그때 쓰려고 지금 같이 적어둔다) */
export const DISLIKE_CHOICES: { key: string; label: string; ja: string }[] = [
  { key: 'cilantro', label: '고수(파쿠치)', ja: 'パクチー' },
  { key: 'lamb', label: '양고기', ja: 'ラム肉' },
  { key: 'olive', label: '올리브', ja: 'オリーブ' },
  { key: 'blue_cheese', label: '블루치즈', ja: 'ブルーチーズ' },
  { key: 'natto', label: '낫토', ja: '納豆' },
  { key: 'wasabi', label: '고추냉이', ja: 'わさび' },
  { key: 'raw_fish', label: '날생선', ja: '生魚' },
  { key: 'innards', label: '내장', ja: 'モツ' },
]

export const dislikeLabel = (key: string) =>
  DISLIKE_CHOICES.find((d) => d.key === key)?.label ?? key

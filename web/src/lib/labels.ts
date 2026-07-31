import type { MenuItem, MenuTag } from '../types/api'
import type { LocalizedText } from './i18n'

/** 배지 스타일은 목업(찍먹 목업.dc.html)의 BADGE 맵을 그대로 옮겼다. */
interface Badge {
  label: LocalizedText
  className: string
  dot?: string
}

const NEUTRAL = 'bg-[#F1E7D9] text-[#8A7266]'

export const TAG_BADGE: Record<MenuTag, Badge> = {
  signature: { label: { ko: '시그니처', ja: '看板料理' }, className: 'bg-amber-100 text-amber-700', dot: 'bg-amber' },
  local: { label: { ko: '향토', ja: '郷土料理' }, className: 'bg-sage-100 text-sage-700', dot: 'bg-sage' },
  caution: { label: { ko: '주의', ja: '注意' }, className: 'bg-[#FBEBD0] text-[#9A6B18]', dot: 'bg-amber' },
  spicy: { label: { ko: '매움', ja: '辛い' }, className: 'bg-brand-100 text-brand-700' },
  raw: { label: { ko: '생식', ja: '生もの' }, className: 'bg-[#FBEBD0] text-[#9A6B18]', dot: 'bg-amber' },
  vegetarian: { label: { ko: '채식', ja: 'ベジタリアン' }, className: 'bg-sage-100 text-sage-700' },
  vegan: { label: { ko: '비건', ja: 'ヴィーガン' }, className: 'bg-sage-100 text-sage-700' },
  alcohol: { label: { ko: '주류', ja: 'お酒' }, className: 'bg-[#EFE0D3] text-[#96613A]' },
  share: { label: { ko: '나눠먹기', ja: 'シェア向き' }, className: NEUTRAL },
  single_portion: { label: { ko: '1인분', ja: '1人前' }, className: NEUTRAL },
  pork: { label: { ko: '돼지', ja: '豚肉' }, className: NEUTRAL },
  beef: { label: { ko: '소고기', ja: '牛肉' }, className: NEUTRAL },
  chicken: { label: { ko: '닭', ja: '鶏肉' }, className: NEUTRAL },
  seafood: { label: { ko: '해산물', ja: '魚介' }, className: NEUTRAL },
  noodle: { label: { ko: '면', ja: '麺' }, className: NEUTRAL },
  rice: { label: { ko: '밥', ja: 'ご飯' }, className: NEUTRAL },
  soup: { label: { ko: '국물', ja: 'スープ' }, className: NEUTRAL },
  fried: { label: { ko: '튀김', ja: '揚げ物' }, className: NEUTRAL },
  dessert: { label: { ko: '디저트', ja: 'デザート' }, className: NEUTRAL },
}

/** 배지를 다 붙이면 카드가 지저분해진다. 주문 판단에 실제로 쓰이는 것부터 보여주고 자른다. */
const PRIORITY: MenuTag[] = [
  'signature', 'caution', 'raw', 'spicy', 'local',
  'vegan', 'vegetarian', 'alcohol',
  'pork', 'beef', 'chicken', 'seafood',
  'share', 'single_portion',
  'noodle', 'rice', 'soup', 'fried', 'dessert',
]

const MAX_BADGES = 4

export function visibleTags(tags: MenuTag[]): MenuTag[] {
  return PRIORITY.filter((t) => tags.includes(t)).slice(0, MAX_BADGES)
}

/** 음식 사진이 없는 자리를 채우는 아이콘. 태그 → 카테고리 순으로 고른다.
 *  (실제 참고 이미지는 다음 단계에서 붙인다) */
const TAG_EMOJI: Partial<Record<MenuTag, string>> = {
  noodle: '🍜',
  soup: '🍲',
  rice: '🍚',
  fried: '🍤',
  dessert: '🍰',
  alcohol: '🍶',
  seafood: '🐟',
  beef: '🥩',
  pork: '🥓',
  chicken: '🍗',
  vegan: '🥗',
  vegetarian: '🥗',
}

const CATEGORY_EMOJI: Record<MenuItem['category'], string> = {
  food: '🍽️',
  drink: '🥤',
  dessert: '🍰',
  set: '🍱',
  unknown: '🍽️',
}

export function dishEmoji(item: MenuItem): string {
  for (const tag of PRIORITY) {
    if (item.tags.includes(tag) && TAG_EMOJI[tag]) return TAG_EMOJI[tag]
  }
  return CATEGORY_EMOJI[item.category] ?? '🍽️'
}

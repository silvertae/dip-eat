import type { MenuItem, MenuTag } from '../types/api'

/** 배지 스타일은 목업(찍먹 목업.dc.html)의 BADGE 맵을 그대로 옮겼다. */
interface Badge {
  label: string
  className: string
  dot?: string
}

const NEUTRAL = 'bg-[#F1E7D9] text-[#8A7266]'

export const TAG_BADGE: Record<MenuTag, Badge> = {
  signature: { label: '시그니처', className: 'bg-amber-100 text-amber-700', dot: 'bg-amber' },
  local: { label: '향토', className: 'bg-sage-100 text-sage-700', dot: 'bg-sage' },
  caution: { label: '주의', className: 'bg-[#FBEBD0] text-[#9A6B18]', dot: 'bg-amber' },
  spicy: { label: '매움', className: 'bg-brand-100 text-brand-700' },
  raw: { label: '생식', className: 'bg-[#FBEBD0] text-[#9A6B18]', dot: 'bg-amber' },
  vegetarian: { label: '채식', className: 'bg-sage-100 text-sage-700' },
  vegan: { label: '비건', className: 'bg-sage-100 text-sage-700' },
  alcohol: { label: '주류', className: 'bg-[#EFE0D3] text-[#96613A]' },
  share: { label: '나눠먹기', className: NEUTRAL },
  single_portion: { label: '1인분', className: NEUTRAL },
  pork: { label: '돼지', className: NEUTRAL },
  beef: { label: '소고기', className: NEUTRAL },
  chicken: { label: '닭', className: NEUTRAL },
  seafood: { label: '해산물', className: NEUTRAL },
  noodle: { label: '면', className: NEUTRAL },
  rice: { label: '밥', className: NEUTRAL },
  soup: { label: '국물', className: NEUTRAL },
  fried: { label: '튀김', className: NEUTRAL },
  dessert: { label: '디저트', className: NEUTRAL },
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

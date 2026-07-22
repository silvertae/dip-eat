import { matchedAllergens } from './allergy'
import type { AllergenCode, MenuItem } from '../types/api'

export interface Filters {
  /** 프로필 알레르기가 의심되는 항목을 숨긴다. 기본은 꺼짐 —
   *  추정값으로 사용자 모르게 메뉴를 없애지 않는다. 숨기려면 직접 켜야 한다. */
  hideAllergens: boolean
  localOnly: boolean
  noAlcohol: boolean
}

export const NO_FILTERS: Filters = {
  hideAllergens: false,
  localOnly: false,
  noAlcohol: false,
}

export function applyFilters(
  items: MenuItem[],
  filters: Filters,
  profileAllergies: AllergenCode[],
): MenuItem[] {
  return items.filter((item) => {
    if (filters.hideAllergens && matchedAllergens(item, profileAllergies).length > 0) return false
    if (filters.localOnly && !item.tags.includes('local')) return false
    // '주류 제외'는 술만 뺀다. 주스·차까지 빼면 이름과 다르게 동작한다.
    if (filters.noAlcohol && item.tags.includes('alcohol')) return false
    return true
  })
}

const MEATY = ['pork', 'beef', 'chicken', 'seafood'] as const

/** 채식 위주면 고기·해산물을 분류 안에서 뒤로 민다(설정 문구가 약속하는 동작).
 *  분류를 가로질러 재정렬하지는 않는다 — 메뉴판을 보는 순서가 깨진다. */
export function sortForVegetarian(items: MenuItem[], vegetarian: boolean): MenuItem[] {
  if (!vegetarian) return items
  const meaty = (item: MenuItem) => (item.tags.some((t) => MEATY.includes(t as never)) ? 1 : 0)
  return [...items].sort((a, b) => meaty(a) - meaty(b))
}

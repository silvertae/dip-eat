import { itemKey } from '../store/app'
import type { MenuItem } from '../types/api'

export interface CartLine {
  item: MenuItem
  qty: number
}

export function cartLines(items: MenuItem[], cart: Record<string, number>): CartLine[] {
  return items
    .map((item) => ({ item, qty: cart[itemKey(item)] ?? 0 }))
    .filter((line) => line.qty > 0)
}

export function cartTotals(lines: CartLine[]) {
  const priced = lines.filter((l) => l.item.price_amount != null)
  return {
    count: lines.reduce((sum, l) => sum + l.qty, 0),
    localTotal: priced.reduce((sum, l) => sum + (l.item.price_amount ?? 0) * l.qty, 0),
    /** 가격을 못 읽어 합계에서 빠진 항목 수. 말없이 빼면 예산을 잘못 판단하게 된다. */
    missingPrice: lines.length - priced.length,
  }
}

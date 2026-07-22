import { BudgetGauge } from './BudgetGauge'
import { type CartLine, cartTotals } from '../lib/cart'
import { formatKrw, formatLocal } from '../lib/fx'
import { useProfile } from '../store/profile'

/** 목업의 하단 장바구니 바. */
export function CartBar({
  lines,
  currency,
  rate,
}: {
  lines: CartLine[]
  currency: string
  rate: number | null
}) {
  const restaurantBudget = useProfile((s) => s.restaurantBudget)
  if (lines.length === 0) return null

  const { count, localTotal, missingPrice } = cartTotals(lines)
  const krwTotal = rate != null ? localTotal * rate : null

  return (
    <div className="shrink-0 border-t border-line bg-white px-4 pb-[13px] pt-[11px]">
      <p className="mb-2 text-xs text-muted">
        장바구니 {count} · 합계 <b className="text-ink">{formatLocal(localTotal, currency)}</b>
        {krwTotal != null && <span> ({formatKrw(krwTotal)})</span>}
      </p>

      {missingPrice > 0 && (
        <p className="mb-2 text-[11px] text-amber-700">
          가격을 읽지 못한 {missingPrice}개는 합계에서 빠졌어요
        </p>
      )}

      {/* 환율을 모르면 원화 예산과 비교할 수 없다 — 그럴 땐 게이지를 그리지 않는다. */}
      {krwTotal != null && (
        <div className="mb-2.5">
          <BudgetGauge spentKrw={krwTotal} budgetKrw={restaurantBudget} />
        </div>
      )}

      {/* 주문서 화면은 Phase 4 에서 만든다. 죽은 링크 대신 비활성으로 둔다. */}
      <button
        type="button"
        disabled
        className="w-full rounded-[15px] bg-brand px-4 py-3.5 text-[15px] font-extrabold text-white opacity-40"
      >
        주문서 만들기 →
      </button>
    </div>
  )
}

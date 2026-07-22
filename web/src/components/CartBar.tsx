import { formatKrw, formatLocal } from '../lib/fx'
import type { MenuItem } from '../types/api'

/** 목업의 하단 장바구니 바.
 *  예산 게이지는 프로필(여행/식당 예산)이 생기는 Phase 3 에서 붙인다 —
 *  지금 넣으면 없는 값을 지어내야 한다. */
export function CartBar({
  lines,
  currency,
  rate,
}: {
  lines: { item: MenuItem; qty: number }[]
  currency: string
  rate: number | null
}) {
  if (lines.length === 0) return null

  const count = lines.reduce((sum, l) => sum + l.qty, 0)
  const priced = lines.filter((l) => l.item.price_amount != null)
  const localTotal = priced.reduce((sum, l) => sum + (l.item.price_amount ?? 0) * l.qty, 0)
  // 가격을 못 읽은 항목이 있으면 합계가 실제보다 적다는 걸 알려야 한다.
  const missing = lines.length - priced.length

  return (
    <div className="shrink-0 border-t border-line bg-white px-4 pb-[13px] pt-[11px]">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-xs text-muted">
          장바구니 {count} · 합계 <b className="text-ink">{formatLocal(localTotal, currency)}</b>
          {rate != null && <span className="text-muted"> ({formatKrw(localTotal * rate)})</span>}
        </span>
      </div>

      {missing > 0 && (
        <p className="mb-2 text-[11px] text-amber-700">
          가격을 읽지 못한 {missing}개는 합계에서 빠졌어요
        </p>
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

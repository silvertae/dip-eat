import { formatKrw } from '../lib/fx'

/** 목업의 예산 게이지. 색은 목업 SPEC 그대로: <70% sage · <95% amber · ≥95% brand. */
export function BudgetGauge({
  spentKrw,
  budgetKrw,
  label = '이번 식당 예산',
}: {
  spentKrw: number
  budgetKrw: number
  label?: string
}) {
  // 예산 0 은 '설정 안 함'이다 — 0으로 나누지 않고 아예 그리지 않는다.
  if (budgetKrw <= 0) return null

  const pct = Math.min(100, Math.round((spentKrw / budgetKrw) * 100))
  const color = pct < 70 ? 'bg-sage' : pct < 95 ? 'bg-amber' : 'bg-brand'
  const textColor = pct < 70 ? 'text-sage-700' : pct < 95 ? 'text-amber-700' : 'text-brand-700'

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-2 text-[13px]">
        <span className="text-muted">{label}</span>
        <span>
          <b>{formatKrw(spentKrw)}</b>
          <span className="text-muted"> / {formatKrw(budgetKrw)}</span>
        </span>
      </div>
      <div className="h-[9px] overflow-hidden rounded-md bg-[#EFE4DA]">
        <span
          className={`block h-full transition-[width] duration-300 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className={`mt-1.5 text-right text-[11px] font-bold ${textColor}`}>{pct}%</p>
    </div>
  )
}

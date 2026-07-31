import { Link } from 'react-router'
import { BudgetGauge } from './BudgetGauge'
import { type CartLine, cartTotals } from '../lib/cart'
import { formatHome, formatLocal } from '../lib/fx'
import { tr } from '../lib/i18n'
import { homeCurrencyFor } from '../types/locale'
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
  const { travelerLang, budgets } = useProfile()
  const homeCurrency = homeCurrencyFor(travelerLang)
  const restaurantBudget = budgets[homeCurrency].restaurant
  if (lines.length === 0) return null

  const { count, localTotal, missingPrice } = cartTotals(lines)
  const homeTotal = rate != null ? localTotal * rate : null

  return (
    <div className="shrink-0 border-t border-line bg-white px-4 pb-[13px] pt-[11px]">
      <p className="mb-2 text-xs text-muted">
        {tr(travelerLang, { ko: `장바구니 ${count} · 합계 `, ja: `カート ${count}点 · 合計 ` })}
        <b className="text-ink">{formatLocal(localTotal, currency)}</b>
        {homeTotal != null && currency !== homeCurrency && (
          <span> ({formatHome(homeTotal, homeCurrency)})</span>
        )}
      </p>

      {missingPrice > 0 && (
        <p className="mb-2 text-[11px] text-amber-700">
          {tr(travelerLang, {
            ko: `가격을 읽지 못한 ${missingPrice}개는 합계에서 빠졌어요`,
            ja: `価格不明の${missingPrice}点は合計に含まれていません`,
          })}
        </p>
      )}

      {/* 환율을 모르면 원화 예산과 비교할 수 없다 — 그럴 땐 게이지를 그리지 않는다. */}
      {homeTotal != null && (
        <div className="mb-2.5">
          <BudgetGauge
            spentKrw={homeTotal}
            budgetKrw={restaurantBudget}
            currency={homeCurrency}
            label={tr(travelerLang, { ko: '이번 식당 예산', ja: 'この店の予算' })}
          />
        </div>
      )}

      <Link
        to="/order"
        className="block w-full rounded-[15px] bg-brand px-4 py-3.5 text-center text-[15px] font-extrabold text-white"
      >
        {tr(travelerLang, { ko: '주문서 만들기 →', ja: '注文カードを作る →' })}
      </Link>
    </div>
  )
}

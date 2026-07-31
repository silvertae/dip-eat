import { useMemo } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { cartLines, cartTotals } from '../lib/cart'
import { formatHome, formatLocal, rateNow } from '../lib/fx'
import { tr } from '../lib/i18n'
import { useApp } from '../store/app'
import { useProfile } from '../store/profile'
import type { MenuScanResponse } from '../types/api'
import { homeCurrencyFor } from '../types/locale'

/** 주문 확정 후 완료 화면. 결제는 범위 제외 — '맛있게 드세요'로 마무리한다. */
export function DoneScreen() {
  const scan = useApp((s) => s.scan)
  return scan ? <Done scan={scan} /> : <Navigate to="/" replace />
}

function Done({ scan }: { scan: MenuScanResponse }) {
  const navigate = useNavigate()
  const cart = useApp((s) => s.cart)
  const reset = useApp((s) => s.reset)
  const { travelerLang, budgets } = useProfile()
  const homeCurrency = homeCurrencyFor(travelerLang)
  const restaurantBudget = budgets[homeCurrency].restaurant

  const { localTotal } = useMemo(() => cartTotals(cartLines(scan.items, cart)), [scan.items, cart])
  const rate = rateNow(scan.currency, homeCurrency)
  const homeTotal = rate != null ? localTotal * rate : null

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-5 p-8 text-center">
      <div className="grid size-[88px] place-items-center rounded-full bg-sage text-white shadow-[0_16px_30px_-12px_rgba(122,138,94,.6)]">
        <svg viewBox="0 0 24 24" width="46" height="46" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </div>

      <div>
        <p className="text-[23px] font-extrabold -tracking-[0.4px]">
          {tr(travelerLang, { ko: '맛있게 드세요!', ja: 'どうぞお召し上がりください！' })}
        </p>
        <p className="mt-2 text-sm leading-[1.55] text-muted">
          {tr(travelerLang, { ko: '주문이 정리됐어요.', ja: '注文内容をまとめました。' })}
          <br />
          {tr(travelerLang, { ko: '이 화면을 점원에게 보여줘도 좋아요.', ja: 'この画面を店員に見せても大丈夫です。' })}
        </p>
      </div>

      <div className="w-full rounded-2xl border border-line bg-white p-[15px] text-left">
        <div className="flex justify-between text-[13px]">
          <span className="text-muted">{tr(travelerLang, { ko: '주문 금액', ja: '注文金額' })}</span>
          <b>
            {formatLocal(localTotal, scan.currency)}
            {homeTotal != null &&
              scan.currency !== homeCurrency &&
              ` · ${formatHome(homeTotal, homeCurrency)}`}
          </b>
        </div>
        {restaurantBudget > 0 && homeTotal != null && (
          <div className="mt-2 flex justify-between text-[13px]">
            <span className="text-muted">
              {tr(travelerLang, { ko: '이번 식당 예산 잔액', ja: 'この店の予算残額' })}
            </span>
            <b className="text-sage-700">
              {formatHome(Math.max(0, restaurantBudget - homeTotal), homeCurrency)}
            </b>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => {
          reset()
          navigate('/', { replace: true })
        }}
        className="mt-1 w-full rounded-[15px] bg-ink px-4 py-3.5 text-[15px] font-extrabold text-white"
      >
        {tr(travelerLang, { ko: '새 식당 찍기', ja: '別の店を撮る' })}
      </button>
    </div>
  )
}

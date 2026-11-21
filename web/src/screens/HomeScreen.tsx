import { Link, useNavigate } from 'react-router'
import { BudgetGauge } from '../components/BudgetGauge'
import { RecentScans } from '../components/RecentScans'
import { CameraIcon, GearIcon } from '../components/icons'
import { cartLines, cartTotals } from '../lib/cart'
import { allergyChoiceLabel, dislikeLabel } from '../lib/profileOptions'
import { formatHome, rateNow } from '../lib/fx'
import { tr, type LocalizedText } from '../lib/i18n'
import { useApp } from '../store/app'
import { useProfile } from '../store/profile'
import type { CaptureMode } from '../types/api'
import { homeCurrencyFor } from '../types/locale'

const MODES: { key: CaptureMode; label: LocalizedText }[] = [
  { key: 'poster', label: { ko: '벽보', ja: 'ポスター' } },
  { key: 'booklet', label: { ko: '책자', ja: '冊子' } },
  { key: 'kiosk', label: { ko: '키오스크', ja: 'キオスク' } },
]

export function HomeScreen() {
  const navigate = useNavigate()
  const { captureMode, setCaptureMode, scan, cart, resumable, resumeScan, discardPending } = useApp()
  const { allergies, dislikes, vegetarian, travelerLang, budgets } = useProfile()
  const homeCurrency = homeCurrencyFor(travelerLang)
  const { trip: tripBudget, restaurant: restaurantBudget } = budgets[homeCurrency]

  // 이번 식당에 지금까지 담은 금액. 스캔이 없으면 0.
  const rate = scan ? rateNow(scan.currency, homeCurrency) : null
  const spentHome =
    scan && rate != null ? cartTotals(cartLines(scan.items, cart)).localTotal * rate : 0

  return (
    <div className="flex flex-col gap-4 px-4 pb-4 pt-1">
      <header className="flex items-center py-2">
        <img src="/pwa-512x512.png" alt="찍먹" className="size-9" />
        <Link
          to="/settings"
          aria-label={tr(travelerLang, { ko: '설정', ja: '設定' })}
          className="ml-auto p-1 text-muted"
        >
          <GearIcon size={23} />
        </Link>
      </header>

      <div className="relative overflow-hidden rounded-[22px] bg-linear-150 from-brand-2 to-brand p-5 text-white shadow-[0_18px_30px_-14px_rgba(234,90,52,.55)]">
        <div className="absolute -right-6 -top-6 size-[120px] rounded-full bg-white/15" />
        <div className="absolute -bottom-8 right-6 size-[70px] rounded-full bg-white/10" />
        <p className="relative text-[19px] font-extrabold leading-[1.4]">
          {tr(travelerLang, { ko: '해외 식당, 메뉴판만', ja: '海外のレストラン、メニューを' })}
          <br />
          {tr(travelerLang, { ko: '찍으세요 📸', ja: '撮るだけ 📸' })}
        </p>
        <p className="relative mt-2 text-[13px] opacity-90">
          {tr(travelerLang, { ko: '찍으면 해석·주문·대화까지 한 번에', ja: '翻訳・注文・会話までまとめてサポート' })}
        </p>
      </div>

      <button
        type="button"
        onClick={() => navigate('/camera')}
        className="flex w-full items-center justify-center gap-2 rounded-[17px] bg-ink p-[17px] text-base font-extrabold text-white shadow-[0_14px_24px_-10px_rgba(36,21,18,.5)]"
      >
        <CameraIcon size={21} />
        {tr(travelerLang, { ko: '메뉴판 찍기', ja: 'メニューを撮る' })}
      </button>

      {/* 스캔 도중 앱이 닫혔다(iOS 가 백그라운드 PWA 를 정리 등 — 이슈 #33). 사진은 보관돼 있다.
          자동으로 다시 읽지 않는다 — 사용자 모르게 과금·데이터를 쓰면 안 된다. */}
      {resumable === 'restart' && (
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-white p-3.5">
          <p className="flex-1 text-[13px] font-bold">
            {tr(travelerLang, { ko: '읽다 만 메뉴판이 있어요.', ja: '読み取り途中のメニューがあります。' })}
          </p>
          <button
            type="button"
            onClick={() => void resumeScan().then((ok) => navigate(ok ? '/loading' : '/camera'))}
            className="rounded-xl bg-ink px-3 py-2 text-xs font-extrabold text-white"
          >
            {tr(travelerLang, { ko: '다시 읽기', ja: 'もう一度読み取る' })}
          </button>
          <button
            type="button"
            onClick={discardPending}
            aria-label={tr(travelerLang, { ko: '닫기', ja: '閉じる' })}
            className="px-1 text-muted"
          >
            ✕
          </button>
        </div>
      )}

      {/* 선택한 모드는 스캔 요청의 `mode` 로 그대로 전달돼 프롬프트 힌트가 된다. */}
      <div className="flex gap-2">
        {MODES.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setCaptureMode(key)}
            className={`rounded-full px-[13px] py-2 text-xs font-bold ${
              captureMode === key
                ? 'bg-ink text-white'
                : 'border border-line bg-white text-[#6a564a]'
          }`}
          >
            {tr(travelerLang, label)}
          </button>
        ))}
      </div>

      <RecentScans />

      <hr className="border-line" />

      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-extrabold">
          {tr(travelerLang, { ko: '내 프로필', ja: 'マイプロフィール' })}
        </h2>
        <Link to="/settings" className="text-[12.5px] font-bold text-brand-700">
          {tr(travelerLang, { ko: '편집', ja: '編集' })}
        </Link>
      </div>

      <Link to="/settings" className="rounded-2xl border border-line bg-white p-3.5">
        <Row label={tr(travelerLang, { ko: '알레르기', ja: 'アレルギー' })}>
          {allergies.length === 0 ? (
            <span className="text-muted">{tr(travelerLang, { ko: '없음', ja: 'なし' })}</span>
          ) : (
            <b className="text-brand-700">
              {allergies
                .map((code) => allergyChoiceLabel(code, travelerLang))
                .join(', ')}
            </b>
          )}
        </Row>
        <Row label={tr(travelerLang, { ko: '비선호', ja: '苦手' })}>
          {dislikes.length === 0 ? (
            <span className="text-muted">{tr(travelerLang, { ko: '없음', ja: 'なし' })}</span>
          ) : (
            <b>{dislikes.map((key) => dislikeLabel(key, travelerLang)).join(', ')}</b>
          )}
        </Row>
        <Row label={tr(travelerLang, { ko: '채식', ja: 'ベジタリアン' })}>
          <b>
            {vegetarian
              ? tr(travelerLang, { ko: '위주', ja: '優先' })
              : tr(travelerLang, { ko: '아님', ja: 'なし' })}
          </b>
        </Row>
      </Link>

      {(restaurantBudget > 0 || tripBudget > 0) && (
        <div className="rounded-2xl border border-line bg-white p-3.5">
          <BudgetGauge
            spentKrw={spentHome}
            budgetKrw={restaurantBudget}
            currency={homeCurrency}
            label={tr(travelerLang, { ko: '이번 식당 예산', ja: 'この店の予算' })}
          />
          {tripBudget > 0 && (
            <p className="mt-2.5 text-xs text-muted">
              {tr(travelerLang, { ko: '여행 전체 예산', ja: '旅行全体の予算' })}{' '}
              {formatHome(tripBudget, homeCurrency)}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-1 text-[13px]">
      <span className="shrink-0 text-muted">{label}</span>
      <span className="truncate text-right">{children}</span>
    </div>
  )
}

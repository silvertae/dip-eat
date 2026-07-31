import { Chip, Toggle } from './Chip'
import { ALLERGY_CHOICES, DISLIKE_CHOICES } from '../lib/profileOptions'
import { tr } from '../lib/i18n'
import { useProfile } from '../store/profile'
import { homeCurrencyFor, type TravelerLang } from '../types/locale'

/** 온보딩과 설정이 같은 프로필을 편집한다. 화면마다 따로 만들면 반드시 어긋난다. */

export function AllergyFields() {
  const { allergies, toggleAllergy, travelerLang } = useProfile()
  return (
    <section>
      <h3 className="mb-[9px] text-[12.5px] font-extrabold text-brand-700">
        {tr(travelerLang, { ko: '알레르기', ja: 'アレルギー' })}
      </h3>
      <div className="flex flex-wrap gap-2">
        {ALLERGY_CHOICES.map(({ code, label }) => (
          <Chip
            key={code}
            label={label[travelerLang]}
            selected={allergies.includes(code)}
            onClick={() => toggleAllergy(code)}
          />
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted">
        {tr(travelerLang, {
          ko: '메뉴에서 이 재료가 의심되면 경고를 띄워요. AI 추정이라 담기를 막지는 않아요.',
          ja: '含まれる可能性がある料理に警告します。AIの推定なので追加操作は止めません。',
        })}
      </p>
    </section>
  )
}

export function DislikeFields() {
  const { dislikes, toggleDislike, travelerLang } = useProfile()
  return (
    <section>
      <h3 className="mb-[9px] text-[12.5px] font-extrabold text-brand-700">
        {tr(travelerLang, { ko: '비선호', ja: '苦手な食べ物' })}
      </h3>
      <div className="flex flex-wrap gap-2">
        {DISLIKE_CHOICES.map(({ key, label }) => (
          <Chip
            key={key}
            label={label[travelerLang]}
            tone="ink"
            selected={dislikes.includes(key)}
            onClick={() => toggleDislike(key)}
          />
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted">
        {tr(travelerLang, {
          ko: '주문서에 “빼주세요” 문장으로 넣어드려요.',
          ja: '注文カードに「抜いてください」と追加します。',
        })}
      </p>
    </section>
  )
}

export function VegetarianField() {
  const { vegetarian, setVegetarian, travelerLang } = useProfile()
  const label = tr(travelerLang, { ko: '채식 위주', ja: 'ベジタリアン優先' })
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-white px-[15px] py-3.5">
      <div>
        <p className="text-sm font-bold">{label}</p>
        <p className="mt-0.5 text-xs text-muted">
          {tr(travelerLang, { ko: '고기·해산물 메뉴를 뒤로', ja: '肉・魚介料理を後ろに表示' })}
        </p>
      </div>
      <Toggle on={vegetarian} onChange={setVegetarian} label={label} />
    </div>
  )
}

export function BudgetFields() {
  const { travelerLang, budgets, setBudget } = useProfile()
  const currency = homeCurrencyFor(travelerLang)
  const { trip: tripBudget, restaurant: restaurantBudget } = budgets[currency]
  const symbol = currency === 'JPY' ? '¥' : '₩'
  return (
    <div className="rounded-2xl border border-line bg-white p-[15px]">
      <BudgetRow
        label={tr(travelerLang, { ko: '여행 전체 예산', ja: '旅行全体の予算' })}
        symbol={symbol}
        value={tripBudget}
        onChange={(v) => setBudget('trip', v)}
      />
      <div className="my-3 h-px bg-line" />
      <BudgetRow
        label={tr(travelerLang, { ko: '이번 식당 예산', ja: 'この店の予算' })}
        symbol={symbol}
        value={restaurantBudget}
        onChange={(v) => setBudget('restaurant', v)}
      />
      <p className="mt-3 text-[11px] text-muted">
        {tr(travelerLang, { ko: '0 으로 두면 예산 표시를 끕니다.', ja: '0にすると予算表示をオフにします。' })}
      </p>
    </div>
  )
}

function BudgetRow({
  label,
  symbol,
  value,
  onChange,
}: {
  label: string
  symbol: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-sm font-bold">{label}</span>
      <span className="flex items-baseline gap-1">
        <span className="text-muted">{symbol}</span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          step={10000}
          value={value}
          onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
          className="w-28 rounded-lg border border-line px-2 py-1 text-right text-[15px] font-extrabold"
        />
      </span>
    </label>
  )
}

export function LanguagePair() {
  const { travelerLang, setTravelerLang } = useProfile()
  return (
    <div className="rounded-2xl border border-line bg-white p-[15px]">
      <p className="mb-2.5 text-xs font-bold text-muted">
        {tr(travelerLang, { ko: '내 언어', ja: '自分の言語' })}
      </p>
      <div className="flex items-center justify-center gap-3.5">
        {(['ko', 'ja'] as TravelerLang[]).map((lang) => (
          <button
            key={lang}
            type="button"
            onClick={() => setTravelerLang(lang)}
            aria-pressed={travelerLang === lang}
            className={`min-w-28 rounded-xl px-4 py-3 text-center ${
              travelerLang === lang
                ? 'bg-brand text-white'
                : 'border border-line bg-white text-ink'
            }`}
          >
            <span className="block text-[17px] font-extrabold">
              {lang === 'ko' ? '한국어' : '日本語'}
            </span>
            <span className={`block text-[10.5px] ${travelerLang === lang ? 'text-white/80' : 'text-muted'}`}>
              {lang === 'ko' ? 'Korean' : 'Japanese'}
            </span>
          </button>
        ))}
      </div>
      <p className="mt-2.5 text-center text-[10.5px] text-muted">
        {tr(travelerLang, { ko: '메뉴판 언어는 사진에서 자동 감지해요.', ja: 'メニューの言語は写真から自動判定します。' })}
      </p>
    </div>
  )
}

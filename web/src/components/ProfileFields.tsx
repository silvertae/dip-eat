import { Chip, Toggle } from './Chip'
import { ALLERGY_CHOICES, DISLIKE_CHOICES } from '../lib/profileOptions'
import { useProfile } from '../store/profile'

/** 온보딩과 설정이 같은 프로필을 편집한다. 화면마다 따로 만들면 반드시 어긋난다. */

export function AllergyFields() {
  const { allergies, toggleAllergy } = useProfile()
  return (
    <section>
      <h3 className="mb-[9px] text-[12.5px] font-extrabold text-brand-700">알레르기</h3>
      <div className="flex flex-wrap gap-2">
        {ALLERGY_CHOICES.map(({ code, label }) => (
          <Chip
            key={code}
            label={label}
            selected={allergies.includes(code)}
            onClick={() => toggleAllergy(code)}
          />
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted">
        메뉴에서 이 재료가 의심되면 경고를 띄워요. AI 추정이라 담기를 막지는 않아요.
      </p>
    </section>
  )
}

export function DislikeFields() {
  const { dislikes, toggleDislike } = useProfile()
  return (
    <section>
      <h3 className="mb-[9px] text-[12.5px] font-extrabold text-brand-700">비선호</h3>
      <div className="flex flex-wrap gap-2">
        {DISLIKE_CHOICES.map(({ key, label }) => (
          <Chip
            key={key}
            label={label}
            tone="ink"
            selected={dislikes.includes(key)}
            onClick={() => toggleDislike(key)}
          />
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted">
        주문서에 &ldquo;빼주세요&rdquo; 문장으로 넣어드려요.
      </p>
    </section>
  )
}

export function VegetarianField() {
  const { vegetarian, setVegetarian } = useProfile()
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-white px-[15px] py-3.5">
      <div>
        <p className="text-sm font-bold">채식 위주</p>
        <p className="mt-0.5 text-xs text-muted">고기·해산물 메뉴를 뒤로</p>
      </div>
      <Toggle on={vegetarian} onChange={setVegetarian} label="채식 위주" />
    </div>
  )
}

export function BudgetFields() {
  const { tripBudget, restaurantBudget, setBudget } = useProfile()
  return (
    <div className="rounded-2xl border border-line bg-white p-[15px]">
      <BudgetRow
        label="여행 전체 예산"
        value={tripBudget}
        onChange={(v) => setBudget('trip', v)}
      />
      <div className="my-3 h-px bg-line" />
      <BudgetRow
        label="이번 식당 예산"
        value={restaurantBudget}
        onChange={(v) => setBudget('restaurant', v)}
      />
      <p className="mt-3 text-[11px] text-muted">0 으로 두면 예산 표시를 끕니다.</p>
    </div>
  )
}

function BudgetRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-sm font-bold">{label}</span>
      <span className="flex items-baseline gap-1">
        <span className="text-muted">₩</span>
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

/** 내 언어는 한국어 고정, 현지 언어는 사진에서 자동 감지한다. 고를 게 없어 표시만 한다. */
export function LanguagePair() {
  return (
    <div className="rounded-2xl border border-line bg-white p-[15px]">
      <p className="mb-2.5 text-xs font-bold text-muted">언어</p>
      <div className="flex items-center justify-center gap-3.5">
        <div className="text-center">
          <p className="text-[17px] font-extrabold">한국어</p>
          <p className="text-[10.5px] text-muted">내 언어</p>
        </div>
        <span className="grid size-[34px] place-items-center rounded-full bg-brand-100 text-brand-700">
          ⇄
        </span>
        <div className="text-center">
          <p className="text-[17px] font-extrabold">자동 감지</p>
          <p className="text-[10.5px] text-muted">메뉴판 언어</p>
        </div>
      </div>
    </div>
  )
}

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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

/**
 * `type="number"` 는 콤마가 든 값을 표시하지 못한다(브라우저가 invalid 로 보고 비운다).
 * 그래서 text + inputMode="numeric" 으로 두고 숫자만 뽑아 직접 세 자리 구분한다.
 */
function BudgetRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (value: number) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const caretRef = useRef<number | null>(null)
  // 지움 방향은 beforeinput 에만 있다(change 시점엔 이미 사라진 뒤라 구분이 안 된다).
  const deleteDirRef = useRef<'back' | 'forward' | null>(null)
  // 비어 있는 상태("")와 0 을 구분해야 지우자마자 0 이 다시 채워지지 않는다.
  const [draft, setDraft] = useState<string | null>(null)
  const display = draft ?? (value ? value.toLocaleString('ko-KR') : '')

  // React 의 onBeforeInput 은 합성 이벤트라 삭제에는 오지 않는다(textInput/조합 입력에서만
  // 만들어진다). 방향을 알려면 네이티브 beforeinput 을 직접 들어야 한다.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    const remember = (e: Event) => {
      const type = (e as InputEvent).inputType
      deleteDirRef.current =
        type === 'deleteContentBackward'
          ? 'back'
          : type === 'deleteContentForward'
            ? 'forward'
            : null
    }
    el.addEventListener('beforeinput', remember)
    return () => el.removeEventListener('beforeinput', remember)
  }, [])

  // 콤마가 끼면 React 가 되살린 캐럿이 한 칸씩 밀린다 — 숫자 개수 기준으로 다시 잡는다.
  useLayoutEffect(() => {
    if (caretRef.current === null || !inputRef.current) return
    inputRef.current.setSelectionRange(caretRef.current, caretRef.current)
    caretRef.current = null
  })

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value
    const caret = e.target.selectionStart ?? raw.length
    let digitsBeforeCaret = raw.slice(0, caret).replace(/\D/g, '').length
    let digits = raw.replace(/\D/g, '')

    // 콤마 위에서 지우면 브라우저는 콤마만 없앤다 — 숫자가 그대로라 다시 포맷하면 아무 일도
    // 안 한 것처럼 보인다. 구분자는 데이터가 아니므로 건너뛰고 그 너머 숫자를 지운다.
    // 삭제일 때만 — 삽입에도 걸리면 멀쩡한 숫자를 하나 지운다.
    const separatorOnlyDelete =
      deleteDirRef.current !== null &&
      raw.length === display.length - 1 &&
      digits.length === onlyDigits(display).length
    if (separatorOnlyDelete) {
      const target = deleteDirRef.current === 'forward' ? digitsBeforeCaret : digitsBeforeCaret - 1
      if (target >= 0 && target < digits.length) {
        digits = digits.slice(0, target) + digits.slice(target + 1)
        digitsBeforeCaret = target
      }
    }
    deleteDirRef.current = null

    digits = digits.slice(0, 12).replace(/^0+(?=\d)/, '')
    const next = digits ? Number(digits) : 0
    const text = digits ? next.toLocaleString('ko-KR') : ''

    setDraft(text)
    caretRef.current = caretAfterDigits(text, digitsBeforeCaret)
    onChange(next)
  }

  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-sm font-bold">{label}</span>
      <span className="flex items-baseline gap-1">
        <span className="text-muted">₩</span>
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="0"
          value={display}
          onChange={handleChange}
          onBlur={() => setDraft(null)}
          className="w-28 rounded-lg border border-line px-2 py-1 text-right text-[15px] font-extrabold"
        />
      </span>
    </label>
  )
}

const onlyDigits = (s: string) => s.replace(/\D/g, '')

/** 포맷된 문자열에서 숫자 n 개 뒤의 위치. 콤마 삽입으로 밀린 캐럿을 되돌리는 데 쓴다. */
function caretAfterDigits(text: string, n: number) {
  if (n <= 0) return 0
  let seen = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] >= '0' && text[i] <= '9' && ++seen === n) return i + 1
  }
  return text.length
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

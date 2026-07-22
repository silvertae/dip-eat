/** 목업의 선택 칩. 온보딩과 설정이 같은 걸 쓴다(같은 프로필을 편집하므로). */
export function Chip({
  label,
  selected,
  onClick,
  tone = 'brand',
}: {
  label: string
  selected: boolean
  onClick: () => void
  /** 알레르기는 브랜드색, 비선호는 잉크색 — 목업과 동일 */
  tone?: 'brand' | 'ink'
}) {
  const selectedClass =
    tone === 'brand' ? 'bg-brand text-white border-brand' : 'bg-ink text-white border-ink'

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`rounded-full border px-[14px] py-[9px] text-[13px] font-bold ${
        selected ? selectedClass : 'border-line bg-white text-[#6a564a]'
      }`}
    >
      {label}
    </button>
  )
}

export function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean
  onChange: (next: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`h-7 w-[46px] shrink-0 rounded-full p-[3px] transition-colors ${
        on ? 'bg-sage' : 'bg-[#E3D6C6]'
      }`}
    >
      <span
        className={`block size-[22px] rounded-full bg-white shadow transition-transform ${
          on ? 'translate-x-[18px]' : ''
        }`}
      />
    </button>
  )
}

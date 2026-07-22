import {
  AllergyFields,
  BudgetFields,
  DislikeFields,
  LanguagePair,
  VegetarianField,
} from '../components/ProfileFields'
import { useApp } from '../store/app'
import { useProfile } from '../store/profile'
import type { CaptureMode } from '../types/api'

const MODES: { key: CaptureMode; label: string }[] = [
  { key: 'poster', label: '벽보' },
  { key: 'booklet', label: '책자' },
  { key: 'kiosk', label: '키오스크' },
]

/** 온보딩과 같은 필드를 쓴다(같은 프로필이므로). 값은 바꾸는 즉시 저장된다. */
export function SettingsScreen() {
  const { captureMode, setCaptureMode } = useApp()
  const resetProfile = useProfile((s) => s.resetProfile)

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="pt-1">
        <h1 className="text-[22px] font-extrabold -tracking-[0.4px]">설정</h1>
        <p className="mt-1 text-xs text-muted">로그인 없이 이 기기에 저장돼요</p>
      </header>

      <AllergyFields />
      <DislikeFields />
      <VegetarianField />
      <LanguagePair />
      <BudgetFields />

      <div className="rounded-2xl border border-line bg-white p-[15px]">
        <p className="mb-2.5 text-xs font-bold text-muted">촬영 모드 기본값</p>
        <div className="flex gap-2">
          {MODES.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setCaptureMode(key)}
              aria-pressed={captureMode === key}
              className={`rounded-full px-[13px] py-2 text-xs font-bold ${
                captureMode === key
                  ? 'bg-ink text-white'
                  : 'border border-line bg-white text-[#6a564a]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-white">
        <div className="flex items-center justify-between px-[15px] py-3.5 text-sm">
          <span>앱 정보</span>
          <b className="font-semibold text-muted">v0.1.0</b>
        </div>
      </div>

      <button
        type="button"
        onClick={() => {
          if (confirm('알레르기·비선호·예산 설정을 모두 지울까요?')) resetProfile()
        }}
        className="rounded-2xl border border-line bg-white px-4 py-3 text-[13px] font-bold text-brand-700"
      >
        프로필 초기화
      </button>
    </div>
  )
}

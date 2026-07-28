import { useState } from 'react'
import { useNavigate } from 'react-router'
import { BrandLogo } from '../components/BrandLogo'
import {
  AllergyFields,
  BudgetFields,
  DislikeFields,
  LanguagePair,
  VegetarianField,
} from '../components/ProfileFields'
import { useProfile } from '../store/profile'

const LAST_STEP = 2

export function OnboardingScreen() {
  const navigate = useNavigate()
  const finishOnboarding = useProfile((s) => s.finishOnboarding)
  const [step, setStep] = useState(0)

  const done = () => {
    finishOnboarding()
    navigate('/', { replace: true })
  }

  return (
    <div className="flex h-full flex-col px-6 pb-8 pt-1.5">
      <div className="flex items-center justify-between pt-0.5">
        <div className="flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={`h-[5px] w-[26px] rounded ${step >= i ? 'bg-brand' : 'bg-line'}`}
            />
          ))}
        </div>
        {/* 프로필은 나중에 설정에서 언제든 바꿀 수 있으므로 건너뛰기를 막지 않는다. */}
        <button type="button" onClick={done} className="text-[13px] font-bold text-muted">
          건너뛰기
        </button>
      </div>

      {step === 0 && (
        <div className="flex flex-1 flex-col justify-center">
          <BrandLogo variant="full" className="mb-8 w-[64%] max-w-[268px]" />
          <h1 className="text-[32px] font-extrabold leading-[1.2] -tracking-[0.6px]">
            해외 식당,
            <br />
            메뉴판만 찍으세요
          </h1>
          <p className="mt-3 text-[15px] leading-[1.55] text-muted">
            찍으면 해석·주문까지 한 번에.
            <br />
            번역기가 아니라, 옆에 앉은 현지인 친구.
          </p>
        </div>
      )}

      {step === 1 && (
        <div className="flex flex-1 flex-col gap-5 overflow-y-auto pt-6">
          <div>
            <h2 className="text-2xl font-extrabold leading-[1.25] -tracking-[0.5px]">
              못 먹는 음식이
              <br />
              있나요?
            </h2>
            <p className="mt-2 text-[13.5px] text-muted">골라두면 메뉴에서 짚어드려요.</p>
          </div>
          <AllergyFields />
          <DislikeFields />
          <VegetarianField />
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-1 flex-col gap-3.5 overflow-y-auto pt-6">
          <div>
            <h2 className="text-2xl font-extrabold leading-[1.25] -tracking-[0.5px]">
              예산을 정해요
            </h2>
            <p className="mt-2 text-[13.5px] text-muted">여행 중 언제든 바꿀 수 있어요.</p>
          </div>
          <LanguagePair />
          <BudgetFields />
        </div>
      )}

      <div className="flex shrink-0 gap-2.5 pt-3.5">
        {step > 0 && (
          <button
            type="button"
            onClick={() => setStep((s) => s - 1)}
            aria-label="이전"
            className="w-[54px] shrink-0 rounded-2xl border border-line bg-white text-xl text-ink"
          >
            ‹
          </button>
        )}
        <button
          type="button"
          onClick={() => (step === LAST_STEP ? done() : setStep((s) => s + 1))}
          className="flex-1 rounded-2xl bg-brand p-4 text-[15.5px] font-extrabold text-white shadow-[0_12px_22px_-8px_rgba(234,90,52,.6)]"
        >
          {step === LAST_STEP ? '찍먹 시작하기' : step === 0 ? '시작하기' : '다음'}
        </button>
      </div>
    </div>
  )
}

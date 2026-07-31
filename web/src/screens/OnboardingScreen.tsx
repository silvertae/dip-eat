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
import { tr } from '../lib/i18n'

const LAST_STEP = 2

export function OnboardingScreen() {
  const navigate = useNavigate()
  const { finishOnboarding, travelerLang } = useProfile()
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
          {tr(travelerLang, { ko: '건너뛰기', ja: 'スキップ' })}
        </button>
      </div>

      {step === 0 && (
        <div className="flex flex-1 flex-col justify-center">
          <BrandLogo variant="full" className="mb-8 w-[64%] max-w-[268px]" />
          <h1 className="text-[32px] font-extrabold leading-[1.2] -tracking-[0.6px]">
            {tr(travelerLang, { ko: '해외 식당,', ja: '海外のレストラン、' })}
            <br />
            {tr(travelerLang, { ko: '메뉴판만 찍으세요', ja: 'メニューを撮るだけ' })}
          </h1>
          <p className="mt-3 text-[15px] leading-[1.55] text-muted">
            {tr(travelerLang, { ko: '찍으면 해석·주문까지 한 번에.', ja: '撮れば、翻訳から注文まで。' })}
            <br />
            {tr(travelerLang, {
              ko: '번역기가 아니라, 옆에 앉은 현지인 친구.',
              ja: '翻訳機ではなく、隣にいる現地の友だち。',
            })}
          </p>
          <div className="mt-7">
            <LanguagePair />
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="flex flex-1 flex-col gap-5 overflow-y-auto pt-6">
          <div>
            <h2 className="text-2xl font-extrabold leading-[1.25] -tracking-[0.5px]">
              {tr(travelerLang, { ko: '못 먹는 음식이', ja: '食べられないものは' })}
              <br />
              {tr(travelerLang, { ko: '있나요?', ja: 'ありますか？' })}
            </h2>
            <p className="mt-2 text-[13.5px] text-muted">
              {tr(travelerLang, { ko: '골라두면 메뉴에서 짚어드려요.', ja: '選んでおくとメニューでお知らせします。' })}
            </p>
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
              {tr(travelerLang, { ko: '예산을 정해요', ja: '予算を決めましょう' })}
            </h2>
            <p className="mt-2 text-[13.5px] text-muted">
              {tr(travelerLang, { ko: '여행 중 언제든 바꿀 수 있어요.', ja: '旅行中いつでも変更できます。' })}
            </p>
          </div>
          <BudgetFields />
        </div>
      )}

      <div className="flex shrink-0 gap-2.5 pt-3.5">
        {step > 0 && (
          <button
            type="button"
            onClick={() => setStep((s) => s - 1)}
            aria-label={tr(travelerLang, { ko: '이전', ja: '戻る' })}
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
          {step === LAST_STEP
            ? tr(travelerLang, { ko: '찍먹 시작하기', ja: '始める' })
            : step === 0
              ? tr(travelerLang, { ko: '시작하기', ja: 'スタート' })
              : tr(travelerLang, { ko: '다음', ja: '次へ' })}
        </button>
      </div>
    </div>
  )
}

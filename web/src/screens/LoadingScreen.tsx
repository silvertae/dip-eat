import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { useApp } from '../store/app'
import { useProfile } from '../store/profile'
import { tr, type LocalizedText } from '../lib/i18n'

/** '사진 축소'와 '스캔'은 실제로 구분되는 단계라 그 둘만 표시한다. 가짜 진행률은 쓰지 않는다.
 *  스캔이 시작되고 첫 항목이 오면(phase='streaming') 곧바로 결과 화면으로 넘어가므로,
 *  이 화면이 떠 있는 시간은 실측 ~2초다. */
const STEPS: { key: 'resizing' | 'scanning'; label: LocalizedText }[] = [
  { key: 'resizing', label: { ko: '사진 준비', ja: '写真を準備' } },
  { key: 'scanning', label: { ko: '메뉴판 읽기', ja: 'メニューを読取' } },
] as const

export function LoadingScreen() {
  const navigate = useNavigate()
  const { phase, preview, error } = useApp()
  const travelerLang = useProfile((s) => s.travelerLang)

  useEffect(() => {
    // 'streaming' = 첫 항목이 도착했다. 나머지가 오는 동안 결과 화면에서 기다리게 한다 —
    // 이게 스트리밍의 요점이다. 여기서 'done' 만 기다리면 아무 이득이 없다.
    if (phase === 'streaming' || phase === 'done') navigate('/result', { replace: true })
    // 촬영을 시작하지 않고 이 화면에 직접 들어온 경우(새로고침 등)
    if (phase === 'idle') navigate('/', { replace: true })
  }, [phase, navigate])

  if (phase === 'error') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-lg font-extrabold">
          {tr(travelerLang, { ko: '메뉴판을 읽지 못했어요', ja: 'メニューを読み取れませんでした' })}
        </p>
        <p className="text-sm text-muted">{error}</p>
        <button
          type="button"
          onClick={() => navigate('/camera', { replace: true })}
          className="mt-2 w-full rounded-2xl bg-ink p-4 text-[15px] font-extrabold text-white"
        >
          {tr(travelerLang, { ko: '다시 찍기', ja: '撮り直す' })}
        </button>
      </div>
    )
  }

  const activeIndex = phase === 'resizing' ? 0 : 1

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-8 text-center">
      {preview && (
        <img
          src={preview}
          alt={tr(travelerLang, { ko: '촬영본', ja: '撮影した写真' })}
          className="h-[112px] w-[88px] -rotate-3 rounded-xl object-cover shadow-[0_18px_34px_-12px_rgba(60,25,10,.4)]"
        />
      )}

      <div className="size-[52px] animate-spin rounded-full border-4 border-brand-100 border-t-brand" />

      <div>
        <p className="text-[19px] font-extrabold -tracking-[0.3px]">
          {tr(travelerLang, { ko: '메뉴판을 읽고 있어요', ja: 'メニューを読み取っています' })}
        </p>
        <p className="mt-2 text-[13px] text-muted">
          {tr(travelerLang, { ko: '사진 한 장으로 전체를 해석하는 중…', ja: '写真全体を解析中…' })}
        </p>
      </div>

      <ul className="flex w-full max-w-[250px] flex-col gap-3 text-left">
        {STEPS.map(({ key, label }, index) => (
          <li key={key} className="flex items-center gap-3">
            <span
              className={`grid size-[22px] place-items-center rounded-full text-white ${
                index < activeIndex
                  ? 'bg-sage'
                  : index === activeIndex
                    ? 'animate-pulse bg-brand'
                    : 'bg-[#E7DAC9]'
              }`}
            >
              {index < activeIndex && (
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              )}
            </span>
            <span
              className={`text-[13.5px] ${index <= activeIndex ? 'font-bold' : 'text-muted'}`}
            >
              {tr(travelerLang, label)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { useApp } from '../store/app'

/** '사진 축소'와 '스캔'은 실제로 구분되는 단계라 그 둘만 표시한다. 가짜 진행률은 쓰지 않는다.
 *  스캔이 시작되고 첫 항목이 오면(phase='streaming') 곧바로 결과 화면으로 넘어가므로,
 *  이 화면이 떠 있는 시간은 실측 ~2초다. */
const STEPS = [
  { key: 'resizing', label: '사진 준비' },
  { key: 'scanning', label: '메뉴판 읽기' },
] as const

export function LoadingScreen() {
  const navigate = useNavigate()
  const { phase, preview, error } = useApp()

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
        <p className="text-lg font-extrabold">메뉴판을 읽지 못했어요</p>
        <p className="text-sm text-muted">{error}</p>
        <button
          type="button"
          onClick={() => navigate('/camera', { replace: true })}
          className="mt-2 w-full rounded-2xl bg-ink p-4 text-[15px] font-extrabold text-white"
        >
          다시 찍기
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
          alt="촬영본"
          className="h-[112px] w-[88px] -rotate-3 rounded-xl object-cover shadow-[0_18px_34px_-12px_rgba(60,25,10,.4)]"
        />
      )}

      <div className="size-[52px] animate-spin rounded-full border-4 border-brand-100 border-t-brand" />

      <div>
        <p className="text-[19px] font-extrabold -tracking-[0.3px]">메뉴판을 읽고 있어요</p>
        <p className="mt-2 text-[13px] text-muted">사진 한 장으로 전체를 해석하는 중…</p>
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
              {label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

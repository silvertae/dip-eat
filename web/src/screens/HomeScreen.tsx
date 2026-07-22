import { Link, useNavigate } from 'react-router'
import { CameraIcon, GearIcon } from '../components/icons'
import { useApp } from '../store/app'
import type { CaptureMode } from '../types/api'

const MODES: { key: CaptureMode; label: string }[] = [
  { key: 'poster', label: '벽보' },
  { key: 'booklet', label: '책자' },
  { key: 'kiosk', label: '키오스크' },
]

export function HomeScreen() {
  const navigate = useNavigate()
  const { captureMode, setCaptureMode, scan } = useApp()

  return (
    <div className="flex flex-col gap-4 px-4 pb-4 pt-1">
      <header className="flex items-center gap-2 py-2">
        <span className="grid size-9 place-items-center rounded-xl bg-linear-150 from-brand-2 to-brand text-[17px] font-extrabold text-white">
          찍
        </span>
        <b className="text-xl -tracking-[0.3px]">찍먹</b>
        <span aria-disabled className="ml-auto p-1 text-muted opacity-40">
          <GearIcon size={23} />
        </span>
      </header>

      <div className="relative overflow-hidden rounded-[22px] bg-linear-150 from-brand-2 to-brand p-5 text-white shadow-[0_18px_30px_-14px_rgba(234,90,52,.55)]">
        <div className="absolute -right-6 -top-6 size-[120px] rounded-full bg-white/15" />
        <div className="absolute -bottom-8 right-6 size-[70px] rounded-full bg-white/10" />
        <p className="relative text-[19px] font-extrabold leading-[1.4]">
          해외 식당, 메뉴판만
          <br />
          찍으세요 📸
        </p>
        <p className="relative mt-2 text-[13px] opacity-90">찍으면 해석·주문·대화까지 한 번에</p>
      </div>

      <button
        type="button"
        onClick={() => navigate('/camera')}
        className="flex w-full items-center justify-center gap-2 rounded-[17px] bg-ink p-[17px] text-base font-extrabold text-white shadow-[0_14px_24px_-10px_rgba(36,21,18,.5)]"
      >
        <CameraIcon size={21} />
        메뉴판 찍기
      </button>

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
            {label}
          </button>
        ))}
      </div>

      {scan && (
        <>
          <hr className="border-line" />
          <Link
            to="/result"
            className="rounded-2xl border border-line bg-white p-4"
          >
            <p className="text-[13px] text-muted">최근 스캔</p>
            <p className="mt-1 font-local text-base font-extrabold">
              {scan.restaurant.name_local || '이름 미인식'}
            </p>
            <p className="mt-1 text-xs text-muted">
              {scan.items.length}개 · 다시 보기 →
            </p>
          </Link>
        </>
      )}
    </div>
  )
}

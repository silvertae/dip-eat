import { useNavigate } from 'react-router'
import { BackIcon, CameraIcon, ImageIcon } from '../components/icons'
import { CaptureButton } from '../features/capture/CaptureButton'
import { useApp } from '../store/app'
import type { CaptureMode } from '../types/api'

const MODES: { key: CaptureMode; label: string }[] = [
  { key: 'poster', label: '벽보' },
  { key: 'booklet', label: '책자' },
  { key: 'kiosk', label: '키오스크' },
]

/** 목업의 카메라 화면을 '촬영 안내'로 재해석했다.
 *  실시간 뷰파인더(getUserMedia)를 쓰지 않기로 했으므로 스캔 프레임은 정적이고,
 *  "텍스트 N줄 감지됨" 같은 실시간 표시는 근거가 없어서 넣지 않았다. */
export function CameraScreen() {
  const navigate = useNavigate()
  const { captureMode, setCaptureMode, startScan } = useApp()

  function handlePick(file: File) {
    void startScan(file)
    navigate('/loading')
  }

  return (
    <div className="relative flex h-full flex-col bg-[#1c130e] text-white">
      <button
        type="button"
        onClick={() => navigate('/')}
        aria-label="뒤로"
        className="absolute left-4 top-4 z-10 grid size-9 place-items-center rounded-xl bg-black/35 backdrop-blur-sm"
      >
        <BackIcon />
      </button>

      <div className="flex justify-center gap-2 pt-5">
        {MODES.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setCaptureMode(key)}
            className={`rounded-full px-[15px] py-2 text-[12.5px] font-bold ${
              captureMode === key ? 'bg-brand text-white' : 'bg-white/20 text-white backdrop-blur-sm'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 스캔 프레임 — 촬영 구도를 안내하는 정적 가이드 */}
      <div className="relative mx-10 my-8 flex flex-1 items-center justify-center">
        <span className="absolute left-0 top-0 size-[34px] rounded-tl-md border-l-[5px] border-t-[5px] border-brand-2" />
        <span className="absolute right-0 top-0 size-[34px] rounded-tr-md border-r-[5px] border-t-[5px] border-brand-2" />
        <span className="absolute bottom-0 left-0 size-[34px] rounded-bl-md border-b-[5px] border-l-[5px] border-brand-2" />
        <span className="absolute bottom-0 right-0 size-[34px] rounded-br-md border-b-[5px] border-r-[5px] border-brand-2" />

        <div className="flex flex-col gap-2 px-6 text-center">
          <p className="text-[15px] font-bold">메뉴판 전체가 프레임 안에 들어오게</p>
          <p className="text-[13px] text-white/70">
            글자가 작으면 반씩 나눠 찍는 편이 더 정확해요
          </p>
        </div>
      </div>

      <div className="flex items-center justify-center gap-4 px-6 pb-10 pt-8">
        <CaptureButton
          onPick={handlePick}
          className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-white p-4 text-[15px] font-extrabold text-ink"
        >
          <CameraIcon size={20} />
          카메라
        </CaptureButton>
        <CaptureButton
          onPick={handlePick}
          capture={false}
          className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-white/20 p-4 text-[15px] font-extrabold text-white backdrop-blur-sm"
        >
          <ImageIcon size={20} />
          앨범
        </CaptureButton>
      </div>
    </div>
  )
}

import { create } from 'zustand'
import { resizeForUpload } from '../features/capture/resizeImage'
import { ApiError, scanMenu } from '../lib/api'
import type { CaptureMode, MenuScanResponse } from '../types/api'

type ScanPhase = 'idle' | 'resizing' | 'scanning' | 'done' | 'error'

interface AppState {
  captureMode: CaptureMode
  setCaptureMode: (mode: CaptureMode) => void

  /** 촬영본 미리보기 objectURL. 로딩 화면이 보여준다. */
  preview: string | null
  phase: ScanPhase
  scan: MenuScanResponse | null
  error: string | null

  /** 촬영 → 축소 → 스캔. 화면 이동은 호출부(로딩 화면)가 phase 를 보고 한다. */
  startScan: (file: File) => Promise<void>
  reset: () => void
}

export const useApp = create<AppState>((set, get) => ({
  captureMode: 'poster',
  setCaptureMode: (mode) => set({ captureMode: mode }),

  preview: null,
  phase: 'idle',
  scan: null,
  error: null,

  async startScan(file) {
    // 이전 촬영본의 objectURL 을 놓아준다(누수 방지).
    const previous = get().preview
    if (previous) URL.revokeObjectURL(previous)

    set({
      preview: URL.createObjectURL(file),
      phase: 'resizing',
      scan: null,
      error: null,
    })

    try {
      let resized
      try {
        resized = await resizeForUpload(file)
      } catch {
        // 브라우저가 못 디코드하는 형식(HEIC 변환 실패 등). 원문 영문 메시지를
        // 그대로 보여주면 안 된다 — 서버 에러와 같은 기준으로 한국어로 매핑한다.
        throw new Error('이 사진은 열 수 없는 형식이에요. 다른 사진으로 시도해주세요.')
      }

      set({ phase: 'scanning' })
      const scan = await scanMenu(resized.blob, { mode: get().captureMode })
      set({ scan, phase: 'done' })
    } catch (err) {
      set({
        phase: 'error',
        error:
          err instanceof ApiError || err instanceof Error
            ? err.message
            : '알 수 없는 오류가 발생했어요.',
      })
    }
  },

  reset() {
    const previous = get().preview
    if (previous) URL.revokeObjectURL(previous)
    set({ preview: null, phase: 'idle', scan: null, error: null })
  },
}))

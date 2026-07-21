import type { ResizeFailure, ResizeRequest, ResizeResult } from './resize.worker'

/** 긴 변 2048px. 이 정도면 A5 메뉴판 카드의 글자 높이가 OCR 이 필요로 하는 수준을 유지하면서
 *  업로드가 350~700KB 로 떨어진다. A4 전면을 한 장에 담으면 글자가 작아지므로,
 *  UI 에서 "메뉴판을 반씩 나눠 찍어보세요" 안내를 함께 띄운다. */
export const MAX_EDGE = 2048
export const JPEG_QUALITY = 0.78

export interface ResizedImage {
  blob: Blob
  width: number
  height: number
  originalBytes: number
}

function runInWorker(request: ResizeRequest): Promise<ResizeResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./resize.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<ResizeResult | ResizeFailure>) => {
      worker.terminate()
      if (event.data.ok) resolve(event.data)
      else reject(new Error(event.data.error))
    }
    worker.onerror = (event) => {
      worker.terminate()
      reject(new Error(event.message || 'resize worker failed'))
    }
    worker.postMessage(request)
  })
}

/** OffscreenCanvas 가 없거나 워커가 실패한 브라우저용 메인 스레드 경로. */
async function runOnMainThread(request: ResizeRequest): Promise<ResizeResult> {
  const bitmap = await createImageBitmap(request.file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, request.maxEdge / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', request.quality),
  )
  if (!blob) throw new Error('toBlob returned null')
  return { ok: true, blob, width, height }
}

export async function resizeForUpload(file: File | Blob): Promise<ResizedImage> {
  const request: ResizeRequest = { file, maxEdge: MAX_EDGE, quality: JPEG_QUALITY }
  const supportsWorker = typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined'

  const result = supportsWorker
    ? await runInWorker(request).catch(() => runOnMainThread(request))
    : await runOnMainThread(request)

  return {
    blob: result.blob,
    width: result.width,
    height: result.height,
    originalBytes: file.size,
  }
}

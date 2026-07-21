/// <reference lib="webworker" />

/** 촬영본 축소를 메인 스레드 밖에서 한다.
 *  iOS 의 <input capture> 는 12MP 원본(3~5MB)을 그대로 준다. 메인 스레드에서 디코드하면
 *  구형 아이폰에서 UI 가 눈에 띄게 멈춘다. */

export interface ResizeRequest {
  file: Blob
  maxEdge: number
  quality: number
}

export interface ResizeResult {
  ok: true
  blob: Blob
  width: number
  height: number
}

export interface ResizeFailure {
  ok: false
  error: string
}

self.onmessage = async (event: MessageEvent<ResizeRequest>) => {
  const { file, maxEdge, quality } = event.data
  try {
    // imageOrientation:'from-image' 로 EXIF 회전을 여기서 한 번만 적용한다.
    // 이후 캔버스에 별도의 회전 보정을 넣으면 아이폰 사진이 두 번 돌아간다 — 넣지 말 것.
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })

    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2d context unavailable')
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()

    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality })
    const result: ResizeResult = { ok: true, blob, width, height }
    self.postMessage(result)
  } catch (err) {
    const failure: ResizeFailure = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
    self.postMessage(failure)
  }
}

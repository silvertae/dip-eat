/** 홀드-투-토크 녹음.
 *
 *  push-to-talk 는 '누르고 있는 동안 녹음'이라 <input capture>(별도 녹음기 UI)로는 안 되고
 *  getUserMedia + MediaRecorder 가 필요하다.
 *
 *  ⚠️ iOS 설치형 PWA 는 마이크 권한이 실행마다 다시 요청될 수 있다(카메라와 같은 이슈).
 *  권한 거부·미지원은 조용히 삼키지 말고 호출부가 사용자에게 알린다.
 */

export class VoiceUnsupportedError extends Error {}
export class VoicePermissionError extends Error {}

let sharedStream: MediaStream | null = null

/** 세션 동안 마이크 스트림을 재사용한다(홀드마다 권한 프롬프트가 뜨지 않도록). */
async function getStream(): Promise<MediaStream> {
  if (sharedStream && sharedStream.active) return sharedStream
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new VoiceUnsupportedError('이 브라우저는 녹음을 지원하지 않아요.')
  }
  try {
    sharedStream = await navigator.mediaDevices.getUserMedia({ audio: true })
    return sharedStream
  } catch (err) {
    if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
      throw new VoicePermissionError('마이크 권한이 필요해요. 설정에서 허용해주세요.')
    }
    throw new VoiceUnsupportedError('마이크를 열 수 없어요.')
  }
}

/** MediaRecorder 가 낼 수 있는 mime 중 첫 번째. 서버는 audio/*, video/webm|mp4 를 받는다. */
function pickMime(): string {
  const candidates = ['audio/webm', 'audio/mp4', 'audio/ogg']
  const supported = typeof MediaRecorder !== 'undefined' ? MediaRecorder.isTypeSupported : null
  return candidates.find((m) => supported?.(m)) ?? ''
}

export interface Recording {
  /** 녹음을 멈추고 blob 을 돌려준다. */
  stop: () => Promise<Blob>
  /** 버리고 아무것도 돌려주지 않는다. */
  cancel: () => void
}

export async function startRecording(): Promise<Recording> {
  const stream = await getStream()
  const mimeType = pickMime()
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
  const chunks: BlobPart[] = []
  recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data)
  recorder.start()

  let settled = false
  return {
    stop: () =>
      new Promise<Blob>((resolve) => {
        if (settled) return
        settled = true
        recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType || 'audio/webm' }))
        recorder.stop()
      }),
    cancel: () => {
      if (settled) return
      settled = true
      recorder.onstop = null
      if (recorder.state !== 'inactive') recorder.stop()
    },
  }
}

/** 화면을 떠날 때 마이크를 놓아준다. */
export function releaseMic() {
  sharedStream?.getTracks().forEach((t) => t.stop())
  sharedStream = null
}

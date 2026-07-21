import { useRef } from 'react'

/** 촬영 입력은 `<input type="file" capture>` 하나로 간다.
 *
 *  getUserMedia 실시간 프리뷰가 아니라 이걸 쓰는 이유:
 *  iOS 의 홈 화면 설치(standalone) PWA 에서 카메라 권한이 실행마다 다시 요청되는 문제가
 *  iOS 18.5 시점 보고까지 남아 있다. 발표 중 권한 프롬프트가 다시 뜨는 게 최악의 실패다.
 *  이 방식은 네이티브 카메라 앱에 위임하므로 권한 이슈가 없고 풀해상도 원본을 받는다.
 *  실시간 스캐너는 나중에 기능 플래그 뒤에 추가한다.
 */
export function CaptureButton({
  onPick,
  disabled,
  children,
}: {
  onPick: (file: File) => void
  disabled?: boolean
  children: React.ReactNode
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          // 같은 파일을 다시 골라도 change 가 뜨도록 값을 비운다.
          event.target.value = ''
          if (file) onPick(file)
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-ink px-4 py-4 text-base font-extrabold text-white disabled:opacity-50"
      >
        {children}
      </button>
    </>
  )
}

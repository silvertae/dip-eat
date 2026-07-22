import { useId, useRef } from 'react'

/** 촬영 입력은 `<input type="file">` 하나로 간다.
 *
 *  getUserMedia 실시간 프리뷰가 아니라 이걸 쓰는 이유:
 *  iOS 의 홈 화면 설치(standalone) PWA 에서 카메라 권한이 실행마다 다시 요청되는 문제가
 *  iOS 18.5 시점 보고까지 남아 있다. 발표 중 권한 프롬프트가 다시 뜨는 게 최악의 실패다.
 *  이 방식은 네이티브 카메라 앱에 위임하므로 권한 이슈가 없고 풀해상도 원본을 받는다.
 *
 *  `capture` 를 끄면 같은 입력이 사진 라이브러리 선택기가 된다 —
 *  미리 찍어둔 메뉴판을 고르거나, 데스크톱에서 테스트할 때 쓴다.
 */
export function CaptureButton({
  onPick,
  capture = true,
  className,
  children,
}: {
  onPick: (file: File) => void
  capture?: boolean
  className?: string
  children: React.ReactNode
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const id = useId()

  return (
    <>
      <input
        id={id}
        ref={inputRef}
        type="file"
        accept="image/*"
        {...(capture ? { capture: 'environment' as const } : {})}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          // 같은 파일을 다시 골라도 change 가 뜨도록 값을 비운다.
          event.target.value = ''
          if (file) onPick(file)
        }}
      />
      <button type="button" onClick={() => inputRef.current?.click()} className={className}>
        {children}
      </button>
    </>
  )
}

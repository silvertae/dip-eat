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
 *
 *  ⚠️ `accept="image/*"` 를 빼거나 캡처 불가능한 타입으로 바꾸지 말 것.
 *  스펙상 UA 는 `accept` 가 캡처 가능한 타입이 아니면 `capture` 를 **무시해야 한다**.
 *  iOS 시트의 라벨도 이 값에 따라 바뀐다(image/* → "사진 찍기").
 *
 *  플랫폼별 실제 동작:
 *  - 데스크톱(Safari/Chrome/Firefox/Edge 전부): `capture` 를 무시하고 일반 파일 선택창.
 *    즉 맥에서는 두 버튼이 동일하게 동작한다 — iOS 카메라 경로는 데스크톱에서 재현 불가.
 *  - iOS Safari: 바로 후면 카메라. 촬영본은 카메라 롤에 저장되지 않는다(스펙상 금지).
 *  - Android: `user`/`environment` 값을 무시하고 항상 후면. 우리는 후면을 원하므로 무해.
 *
 *  버튼을 둘로 나눈 게 Android 회귀 대응이기도 하다: Android 14/15 + Chrome 에서
 *  `capture` 없는 선택창의 '카메라' 항목이 사라진 사례가 보고돼 있다(미해결).
 *  하나로 합쳤다면 그 기기에서 촬영 자체가 막힌다.
 *
 *  secure context 는 필요 없다 — getUserMedia 와 달리 http://192.168.x.x 에서도 열린다.
 *  (서비스워커·PWA 설치는 여전히 HTTPS 필요)
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

import logoFull from '../assets/logo-full.png'
import logoMark from '../assets/logo-mark.png'

/**
 * 브랜드 워드마크. 빵스틱 레터링이라 웹폰트로 대체할 수 없어 이미지로 둔다.
 *
 * 원본 아트는 near-black 배경 위에 그려져 있어서, 크림색(#fff9f2) 앱에 얹으려고
 * 배경을 벗겨낸 투명 PNG 를 쓴다(경계 픽셀은 배경색 오염을 되돌려 헤일로가 없다).
 */
export function BrandLogo({
  variant = 'mark',
  className = '',
}: {
  /** mark: '찍먹' 만(헤더처럼 작은 자리) · full: 'DIP-EAT' 까지 포함한 락업(온보딩 히어로) */
  variant?: 'mark' | 'full'
  className?: string
}) {
  return (
    <img
      src={variant === 'full' ? logoFull : logoMark}
      // 로고가 곧 서비스명이라 이미지가 안 뜨면 이름이 사라진다 — alt 를 비우지 말 것.
      alt="찍먹"
      className={className}
    />
  )
}

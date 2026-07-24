/** '사진에서 확인' 좌표 변환.
 *
 *  서버가 준 정규화 박스(0~1, 좌상단 원점, **세운 이미지** 기준)를, 사진 위 마커의 컨테이너
 *  기준 % 사각형으로 바꾼다.
 *
 *  이 뷰는 `object-fit:contain` 을 쓴다(cover 아님). 이유: 이 기능의 목적이 "실제 항목을
 *  가리키기"라, 가로형 메뉴판을 3:4 컨테이너에 cover 로 넣으면 좌우가 잘려 **탐지된 항목이
 *  화면에서 사라진다** — 가리킬 대상을 지우는 셈. contain 은 전체를 레터박스로 보여줘 어떤
 *  항목도 잘리지 않는다(레터박스 여백은 컨테이너 bg-ink 로 채움).
 *
 *  절대 픽셀은 상쇄되므로 컨테이너 종횡비(width/height)와 이미지 종횡비만 있으면 된다.
 *  배경은 Gemini 가 본 것과 같은 축소본(upright)이라 imageAspect = naturalWidth/naturalHeight. */

export interface NormBox {
  x: number
  y: number
  w: number
  h: number
}

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

/** object-fit 으로 그린 이미지 위에서, 정규화 박스를 컨테이너 기준 % 사각형으로 변환.
 *  `fit`: contain = 전체를 안에 맞춤(레터박스, 잘림 없음) / cover = 꽉 채우고 넘침을 크롭. */
export function boxToRect(
  box: NormBox,
  containerAspect: number,
  imageAspect: number,
  fit: 'contain' | 'cover' = 'contain',
): Rect {
  // contain=더 작게(전부 보이게), cover=더 크게(꽉 채우고 크롭). 나머지 식은 동일.
  const scale =
    fit === 'cover'
      ? Math.max(containerAspect / imageAspect, 1)
      : Math.min(containerAspect / imageAspect, 1)
  const dw = imageAspect * scale // 그려진 이미지 너비(컨테이너=1 기준 단위)
  const dh = scale // 그려진 이미지 높이
  const offX = (containerAspect - dw) / 2 // 가운데 정렬 여백(contain ≥0, cover ≤0)
  const offY = (1 - dh) / 2
  return {
    left: ((offX + box.x * dw) / containerAspect) * 100,
    top: (offY + box.y * dh) * 100,
    width: ((box.w * dw) / containerAspect) * 100,
    height: box.h * dh * 100,
  }
}

/** 배지가 크롭 영역으로 사라지지 않게 마진 안으로 가둔다. */
export const clampPct = (v: number, lo = 2, hi = 98) => Math.min(hi, Math.max(lo, v))

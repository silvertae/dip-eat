/** 생성된 OpenAPI 타입(api.gen.ts)에 사람이 쓰기 좋은 이름을 붙인 얇은 레이어.
 *  스키마를 손으로 다시 쓰지 않는다 — `npm run gen:api` 로 재생성. */
import type { components } from './api.gen'

export type MenuScanResponse = components['schemas']['MenuScanResponse']
export type MenuItem = components['schemas']['MenuItem']
export type LikelyAllergen = components['schemas']['LikelyAllergen']
export type Restaurant = components['schemas']['Restaurant']
export type MenuTag = MenuItem['tags'][number]
export type AllergenCode = LikelyAllergen['code']
export type CaptureMode = 'poster' | 'booklet' | 'kiosk'

/** 서버가 DipeatError 를 매핑해 내려주는 본문. */
export interface ApiErrorBody {
  code: string
  message: string
  detail?: string | null
}

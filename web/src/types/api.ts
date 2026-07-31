/** 생성된 OpenAPI 타입(api.gen.ts)에 사람이 쓰기 좋은 이름을 붙인 얇은 레이어.
 *  스키마를 손으로 다시 쓰지 않는다 — `npm run gen:api` 로 재생성. */
import type { components } from './api.gen'
import type { TravelerLang } from './locale'

/** 1단계: 사진 → 목록. 카드에 필요한 것만 들어 있다(가볍게 유지할 것). */
type GeneratedMenuScanResponse = components['schemas']['MenuScanResponse']
/** traveler_lang 가 없는 v1 localStorage/IndexedDB 결과도 지연 마이그레이션으로 읽는다. */
export type MenuScanResponse = Omit<GeneratedMenuScanResponse, 'traveler_lang'> & {
  traveler_lang?: TravelerLang
}
export type MenuItem = components['schemas']['MenuItemSummary']
export type Restaurant = components['schemas']['Restaurant']

/** 2단계: 카드를 탭했을 때. 긴 설명·알레르기 근거는 여기에만 있다. */
export type ExplainRequest = components['schemas']['ExplainRequest']
export type ExplainResponse = components['schemas']['ExplainResponse']
export type LikelyAllergen = components['schemas']['LikelyAllergen']

/** 3단계: '사진에서 확인' 탭. 장바구니 항목의 사진 속 위치(0~1 정규화). */
export type LocateResponse = components['schemas']['LocateResponse']
export type ItemBox = components['schemas']['ItemBox']

export type MenuTag = MenuItem['tags'][number]
export type AllergenCode = MenuItem['allergens'][number]
export type CaptureMode = 'poster' | 'booklet' | 'kiosk'

/** 서버가 DipeatError 를 매핑해 내려주는 본문. */
export interface ApiErrorBody {
  code: string
  message: string
  detail?: string | null
}

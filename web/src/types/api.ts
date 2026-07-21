/** 생성된 OpenAPI 타입(api.gen.ts)에 사람이 쓰기 좋은 이름을 붙인 얇은 레이어.
 *  스키마를 손으로 다시 쓰지 않는다 — `npm run gen:api` 로 재생성. */
import type { components } from './api.gen'

/** 1단계: 사진 → 목록. 카드에 필요한 것만 들어 있다(가볍게 유지할 것). */
export type MenuScanResponse = components['schemas']['MenuScanResponse']
export type MenuItem = components['schemas']['MenuItemSummary']
export type Restaurant = components['schemas']['Restaurant']

/** 2단계: 카드를 탭했을 때. 긴 설명·알레르기 근거는 여기에만 있다. */
export type ExplainRequest = components['schemas']['ExplainRequest']
export type ExplainResponse = components['schemas']['ExplainResponse']
export type LikelyAllergen = components['schemas']['LikelyAllergen']

export type MenuTag = MenuItem['tags'][number]
export type AllergenCode = MenuItem['allergens'][number]
export type CaptureMode = 'poster' | 'booklet' | 'kiosk'

/** 서버가 DipeatError 를 매핑해 내려주는 본문. */
export interface ApiErrorBody {
  code: string
  message: string
  detail?: string | null
}

/** 알레르기 코드 → 한국어. 프로필 칩과 결과 배지가 같은 표를 쓴다. */
export const ALLERGEN_LABEL: Record<AllergenCode, string> = {
  egg: '계란',
  milk: '우유',
  buckwheat: '메밀',
  peanut: '땅콩',
  soy: '대두',
  wheat: '밀',
  gluten: '글루텐',
  mackerel: '고등어',
  fish: '생선',
  crab: '게',
  shrimp: '새우',
  crustacean: '갑각류',
  squid: '오징어',
  shellfish: '조개류',
  mollusk: '연체류',
  pork: '돼지고기',
  beef: '쇠고기',
  chicken: '닭고기',
  peach: '복숭아',
  tomato: '토마토',
  sulfite: '아황산류',
  walnut: '호두',
  pine_nut: '잣',
  tree_nut: '견과류',
  sesame: '참깨',
  celery: '셀러리',
  mustard: '겨자',
  alcohol: '주류',
  other: '기타',
}

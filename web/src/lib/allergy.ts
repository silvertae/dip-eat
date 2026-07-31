import { ALLERGY_CHOICES } from './profileOptions'
import type { AllergenCode, MenuItem } from '../types/api'
import type { TravelerLang } from '../types/locale'
import type { LocalizedText } from './i18n'

const ALLERGEN_NAMES: Record<AllergenCode, LocalizedText> = {
  egg: { ko: '계란', ja: '卵' },
  milk: { ko: '우유', ja: '乳' },
  buckwheat: { ko: '메밀', ja: 'そば' },
  peanut: { ko: '땅콩', ja: '落花生' },
  soy: { ko: '대두', ja: '大豆' },
  wheat: { ko: '밀', ja: '小麦' },
  gluten: { ko: '글루텐', ja: 'グルテン' },
  mackerel: { ko: '고등어', ja: 'さば' },
  fish: { ko: '생선', ja: '魚' },
  crab: { ko: '게', ja: 'かに' },
  shrimp: { ko: '새우', ja: 'えび' },
  crustacean: { ko: '갑각류', ja: '甲殻類' },
  squid: { ko: '오징어', ja: 'いか' },
  shellfish: { ko: '조개류', ja: '貝類' },
  mollusk: { ko: '연체류', ja: '軟体類' },
  pork: { ko: '돼지고기', ja: '豚肉' },
  beef: { ko: '쇠고기', ja: '牛肉' },
  chicken: { ko: '닭고기', ja: '鶏肉' },
  peach: { ko: '복숭아', ja: 'もも' },
  tomato: { ko: '토마토', ja: 'トマト' },
  sulfite: { ko: '아황산류', ja: '亜硫酸塩' },
  walnut: { ko: '호두', ja: 'くるみ' },
  pine_nut: { ko: '잣', ja: '松の実' },
  tree_nut: { ko: '견과류', ja: 'ナッツ類' },
  sesame: { ko: '참깨', ja: 'ごま' },
  celery: { ko: '셀러리', ja: 'セロリ' },
  mustard: { ko: '겨자', ja: 'マスタード' },
  alcohol: { ko: '주류', ja: 'アルコール' },
  other: { ko: '기타', ja: 'その他' },
}

/** 프로필에 등록한 알레르기와 이 메뉴의 추정 알레르기가 겹치는 것.
 *
 *  대조는 전부 클라이언트에서 한다 — 프로필이 서버로 나가지 않고, 프로필을 바꿔도
 *  재스캔이 필요 없다.
 *
 *  ⚠️ 이 결과로 주문을 '차단'하지 않는다. item.allergens 는 메뉴판에서 읽은 사실이 아니라
 *  요리 지식에서 추론한 값이라 양방향으로 틀린다. 경고만 하고 판단은 사용자에게 맡긴다.
 */
export function matchedAllergens(item: MenuItem, profile: AllergenCode[]): AllergenCode[] {
  if (profile.length === 0) return []
  return item.allergens.filter((code) => profile.includes(code))
}

export const allergenLabel = (code: AllergenCode, lang: TravelerLang = 'ko') =>
  ALLERGEN_NAMES[code]?.[lang] ??
  ALLERGY_CHOICES.find((a) => a.code === code)?.label[lang] ??
  code

/** 앞 단어의 받침에 따라 '이/가'를 고른다. ("계란가" 같은 문장이 나오면 안 된다) */
export function subjectParticle(phrase: string): '이' | '가' {
  const last = phrase.trim().slice(-1)
  const code = last.charCodeAt(0)
  // 한글 음절이 아니면(숫자·영문·이모지) 기본형
  if (Number.isNaN(code) || code < 0xac00 || code > 0xd7a3) return '가'
  return (code - 0xac00) % 28 === 0 ? '가' : '이'
}

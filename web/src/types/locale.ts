export type TravelerLang = 'ko' | 'ja'
export type HomeCurrency = 'KRW' | 'JPY'

export const homeCurrencyFor = (lang: TravelerLang): HomeCurrency =>
  lang === 'ja' ? 'JPY' : 'KRW'

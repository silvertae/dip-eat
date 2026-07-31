import type { TravelerLang } from '../types/locale'

export interface LocalizedText {
  ko: string
  ja: string
}

export const tr = (lang: TravelerLang, text: LocalizedText): string => text[lang]

export const languageName = (lang: TravelerLang): string =>
  lang === 'ja' ? '日本語' : '한국어'

export const sourceLanguageName = (code: string, uiLang: TravelerLang): string => {
  const names: Record<string, LocalizedText> = {
    ko: { ko: '한국어', ja: '韓国語' },
    ja: { ko: '일본어', ja: '日本語' },
    en: { ko: '영어', ja: '英語' },
    zh: { ko: '중국어', ja: '中国語' },
  }
  return names[code]?.[uiLang] ?? code
}

const API_ERRORS: Record<string, LocalizedText> = {
  network_error: {
    ko: '연결에 실패했어요. 네트워크를 확인하고 다시 시도해주세요.',
    ja: '接続できませんでした。ネットワークを確認して、もう一度お試しください。',
  },
  payload_too_large: {
    ko: '사진 용량이 너무 커요. 조금 더 작게 찍어주세요.',
    ja: '写真の容量が大きすぎます。少し小さく撮影してください。',
  },
  unsupported_image: {
    ko: '지원하지 않는 이미지 형식이에요.',
    ja: '対応していない画像形式です。',
  },
  unreadable_menu: {
    ko: '메뉴판을 읽지 못했어요. 글자가 잘 보이게 다시 찍어주세요.',
    ja: 'メニューを読み取れませんでした。文字が見えるように撮り直してください。',
  },
  no_menu_found: {
    ko: '사진에서 메뉴판을 찾지 못했어요.',
    ja: '写真からメニューを見つけられませんでした。',
  },
  upstream_timeout: {
    ko: '메뉴판을 읽는 데 시간이 너무 오래 걸렸어요. 다시 시도해주세요.',
    ja: '読み取りに時間がかかりすぎました。もう一度お試しください。',
  },
  upstream_error: {
    ko: '메뉴 인식 서비스에 문제가 있어요. 잠시 후 다시 시도해주세요.',
    ja: 'メニュー認識サービスで問題が発生しました。しばらくしてからお試しください。',
  },
  upstream_rate_limited: {
    ko: '요청이 몰리고 있어요. 잠시 후 다시 시도해주세요.',
    ja: 'アクセスが集中しています。しばらくしてからお試しください。',
  },
  upstream_config_error: {
    ko: '메뉴 인식 서비스 설정에 문제가 있어요. 잠시 후 다시 시도해주세요.',
    ja: 'メニュー認識サービスの設定に問題があります。しばらくしてからお試しください。',
  },
  invalid_request: {
    ko: '요청 형식이 올바르지 않아요.',
    ja: 'リクエストの形式が正しくありません。',
  },
  internal_error: {
    ko: '일시적인 오류가 발생했어요. 다시 시도해주세요.',
    ja: '一時的なエラーが発生しました。もう一度お試しください。',
  },
  unsupported_audio: {
    ko: '지원하지 않는 오디오 형식이에요.',
    ja: '対応していない音声形式です。',
  },
  audio_too_large: {
    ko: '녹음이 너무 길어요. 짧게 말해주세요.',
    ja: '録音が長すぎます。短く話してください。',
  },
  unclear_audio: {
    ko: '잘 안 들렸어요. 다시 말해주세요.',
    ja: '聞き取れませんでした。もう一度話してください。',
  },
}

export const apiErrorText = (
  lang: TravelerLang,
  code: string,
  fallback: string,
): string => API_ERRORS[code]?.[lang] ?? fallback

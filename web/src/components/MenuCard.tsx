import { useCallback, useState } from 'react'
import { ApiError, explainItem } from '../lib/api'
import { allergenLabel, matchedAllergens, subjectParticle } from '../lib/allergy'
import { useDishImage } from '../lib/dishImage'
import { toKrw } from '../lib/fx'
import { TAG_BADGE, visibleTags } from '../lib/labels'
import { DishThumb } from './DishThumb'
import { itemKey, useApp } from '../store/app'
import { useProfile } from '../store/profile'
import { ALLERGEN_LABEL, type ExplainResponse, type MenuItem } from '../types/api'

/** 목업(찍먹 목업.dc.html)의 MenuCard 를 옮긴 것. */
export function MenuCard({
  item,
  sourceLang,
  cuisineHint,
  rate,
}: {
  item: MenuItem
  sourceLang: string
  cuisineHint: string
  /** 1 현지통화 = ? 원. 모르면 null → ₩ 를 숨긴다. */
  rate: number | null
}) {
  const key = itemKey(item)
  const profileAllergies = useProfile((s) => s.allergies)
  const warned = matchedAllergens(item, profileAllergies)
  const qty = useApp((s) => s.cart[key] ?? 0)
  const addToCart = useApp((s) => s.addToCart)
  const removeFromCart = useApp((s) => s.removeFromCart)

  const [detail, setDetail] = useState<ExplainResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // 상세 참고 이미지가 못 뜨면(썸네일과 같은 이유) 이미지 블록 자체를 숨긴다.
  const [detailImgBroken, setDetailImgBroken] = useState(false)

  const toggle = useCallback(async () => {
    if (detail) return setDetail(null)
    setLoading(true)
    setError('')
    try {
      setDetail(
        await explainItem({
          name_local: item.name_local,
          name_translated: item.name_translated,
          source_lang: sourceLang,
          cuisine_hint: cuisineHint,
        }),
      )
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '설명을 불러오지 못했어요.')
    } finally {
      setLoading(false)
    }
  }, [detail, item.name_local, item.name_translated, sourceLang, cuisineHint])

  const krw = toKrw(item.price_amount, rate)
  const image = useDishImage(item)
  const warnedText = warned.map(allergenLabel).join(' · ')

  return (
    <article
      className={`rounded-[18px] border p-[13px] ${
        warned.length > 0 ? 'border-[#F6C9BF] bg-[#FFF4F1]' : 'border-line bg-card'
      }`}
    >
      <div className="flex items-start gap-[11px]">
        <DishThumb item={item} image={image} onClick={toggle} />

        <div className="min-w-0 flex-1">
          <button type="button" onClick={toggle} className="w-full text-left">
            <p className="text-[15.5px] font-extrabold leading-[1.15]">{item.name_translated}</p>
            {/* 원문은 항상 노출한다 — 사용자가 점원에게 이 글자를 그대로 보여준다. */}
            <p className="mt-px font-local text-xs text-muted">{item.name_local}</p>
            <p className="mt-1.5 text-xs leading-[1.5] text-[#5c483d]">{item.summary}</p>
          </button>

          <div className="mt-2 flex flex-wrap gap-[5px]">
            {visibleTags(item.tags).map((tag) => {
              const badge = TAG_BADGE[tag]
              return (
                <span
                  key={tag}
                  className={`inline-flex items-center gap-1 rounded-lg px-2 py-[3px] text-[10px] font-bold ${badge.className}`}
                >
                  {badge.dot && <span className={`size-1.5 rounded-full ${badge.dot}`} />}
                  {badge.label}
                </span>
              )
            })}
            {item.allergens.map((code) => (
              <span
                key={code}
                className={`rounded-lg px-2 py-[3px] text-[10px] font-bold ${
                  warned.includes(code)
                    ? 'bg-brand text-white'
                    : 'bg-brand-100 text-brand-700'
                }`}
              >
                {ALLERGEN_LABEL[code] ?? code}
              </span>
            ))}
            {item.ocr_confidence !== 'high' && (
              <span className="rounded-lg bg-amber-100 px-2 py-[3px] text-[10px] font-bold text-amber-700">
                판독 {item.ocr_confidence}
              </span>
            )}
          </div>

          <div className="mt-[9px] flex items-end justify-between gap-2">
            <div>
              <p className="text-[15px] font-extrabold">{item.price_text || '—'}</p>
              <p className="text-[11px] text-muted">
                {krw ?? '환율 확인 중'}
                {item.tax_included === false && ' · 세금 별도'}
              </p>
            </div>

            {qty === 0 ? (
              <button
                type="button"
                onClick={() => addToCart(key)}
                aria-label={`${item.name_translated} 담기`}
                className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-brand text-xl font-bold text-white"
              >
                ＋
              </button>
            ) : (
              <div className="flex shrink-0 items-center gap-0.5 rounded-[11px] bg-brand-100 p-[3px]">
                <button
                  type="button"
                  onClick={() => removeFromCart(key)}
                  aria-label="하나 빼기"
                  className="size-7 rounded-lg bg-white text-lg font-extrabold text-brand"
                >
                  −
                </button>
                <span className="min-w-5 text-center text-sm font-extrabold text-brand-700">
                  {qty}
                </span>
                <button
                  type="button"
                  onClick={() => addToCart(key)}
                  aria-label="하나 더 담기"
                  className="size-7 rounded-lg bg-brand text-lg font-extrabold text-white"
                >
                  ＋
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {warned.length > 0 && (
        <p className="mt-2.5 flex items-start gap-1.5 text-[11.5px] font-semibold text-brand-700">
          <span aria-hidden>⚠️</span>
          <span>
            {warnedText}
            {subjectParticle(warnedText)} 들어 있을 수 있어요.{' '}
            <span className="font-normal opacity-80">
              AI 추정이라 확실하지 않아요 — 점원에게 확인하세요.
            </span>
          </span>
        </p>
      )}

      {loading && <p className="mt-2 text-xs text-muted">설명을 불러오는 중…</p>}
      {error && <p className="mt-2 text-xs text-brand-700">{error}</p>}

      {detail && (
        <div className="mt-3 border-t border-line pt-3">
          {image && !detailImgBroken && (
            <figure className="mb-3">
              <img
                src={image.url}
                alt={`${item.name_translated} 참고 이미지`}
                // ⚠️ DishThumb 과 같은 이유로 필수 — opaque 응답을 캐시하면 장당 ~4.8MB 패딩이 붙는다.
                crossOrigin="anonymous"
                onError={() => setDetailImgBroken(true)}
                className="h-[150px] w-full rounded-[18px] object-cover"
              />
              {/* 이 식당의 실제 음식이 아니라 같은 요리의 일반 사진이다.
                  CC 라이선스라 저작자·라이선스 표기가 법적 의무다. */}
              <figcaption className="mt-1.5 text-[10.5px] leading-[1.5] text-muted">
                이 가게의 실제 음식 사진이 아니에요 · 참고 이미지
                <br />ⓒ {image.author} ·{' '}
                {image.licenseUrl ? (
                  <a
                    href={image.licenseUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    {image.license}
                  </a>
                ) : (
                  image.license
                )}{' '}
                ·{' '}
                <a href={image.sourceUrl} target="_blank" rel="noreferrer" className="underline">
                  위키미디어 커먼즈
                </a>
              </figcaption>
            </figure>
          )}
          <p className="text-xs text-muted">
            {[detail.romanization, detail.pronunciation_ko].filter(Boolean).join(' · ')}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-[#4d3a30]">{detail.description}</p>
          {detail.tip && <p className="mt-2 text-xs text-sage-700">💡 {detail.tip}</p>}

          {detail.allergens.length > 0 && (
            <div className="mt-3 rounded-xl border border-brand-200 bg-brand-100 p-2">
              {detail.allergens.map((allergen) => (
                <p key={allergen.code} className="text-[11px] text-brand-700">
                  <b>{allergen.label}</b> — {allergen.basis}
                </p>
              ))}
              {/* 식품 안전: 메뉴판에서 읽은 사실이 아니라 AI 추정이다. 반드시 고지한다. */}
              <p className="mt-1 text-[10px] text-brand-700/80">
                AI 추정이에요. 알레르기가 있다면 점원에게 꼭 확인하세요.
              </p>
            </div>
          )}
        </div>
      )}
    </article>
  )
}

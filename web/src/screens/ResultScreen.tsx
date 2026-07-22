import { useCallback, useState } from 'react'
import { Navigate } from 'react-router'
import { ApiError, explainItem } from '../lib/api'
import { useApp } from '../store/app'
import { ALLERGEN_LABEL, type ExplainResponse, type MenuItem } from '../types/api'

/** ⚠️ 아직 목업 디자인이 입혀지지 않은 화면이다(Phase 2d 예정).
 *  Phase 1 의 최소 렌더를 그대로 옮겨 흐름만 이어둔 상태. */
export function ResultScreen() {
  const scan = useApp((s) => s.scan)
  if (!scan) return <Navigate to="/" replace />

  return (
    <div className="flex flex-col gap-3 p-4">
      <div>
        <h2 className="font-local text-lg font-extrabold">
          {scan.restaurant.name_local || '가게 이름 미인식'}
        </h2>
        <p className="text-xs text-muted">
          {[scan.restaurant.cuisine_hint, `${scan.items.length}개 인식`, scan.source_lang]
            .filter(Boolean)
            .join(' · ')}
        </p>
        <p className="mt-1 text-[11px] text-muted">
          {scan.meta.model} · {(scan.meta.latency_ms / 1000).toFixed(1)}s
        </p>
      </div>

      {scan.warnings.map((warning) => (
        <p key={warning} className="rounded-xl bg-amber-100 p-2 text-xs text-amber-700">
          {warning}
        </p>
      ))}

      {scan.items.map((item, index) => (
        <MenuCard
          key={`${item.name_local}-${index}`}
          item={item}
          sourceLang={scan.source_lang}
          cuisineHint={scan.restaurant.cuisine_hint}
        />
      ))}
    </div>
  )
}

/** 목록은 1단계 응답만으로 그린다. 긴 설명은 탭했을 때 2단계로 받아온다 —
 *  그래야 응답시간이 항목 수만큼 곱해지지 않고, 안 여는 메뉴는 비용도 안 든다. */
function MenuCard({
  item,
  sourceLang,
  cuisineHint,
}: {
  item: MenuItem
  sourceLang: string
  cuisineHint: string
}) {
  const [detail, setDetail] = useState<ExplainResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const toggle = useCallback(async () => {
    if (detail) {
      setDetail(null)
      return
    }
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

  return (
    <article className="rounded-2xl border border-line bg-card p-3">
      <button type="button" onClick={toggle} className="w-full text-left">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-extrabold">{item.name_translated}</p>
            {/* 원문은 항상 노출한다 — 사용자가 점원에게 이 글자를 그대로 보여준다. */}
            <p className="font-local text-xs text-muted">{item.name_local}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-extrabold">{item.price_text || '—'}</p>
            {item.tax_included === false && <p className="text-[10px] text-muted">세금 별도</p>}
          </div>
        </div>

        <p className="mt-2 text-xs text-ink/70">{item.summary}</p>

        <div className="mt-2 flex flex-wrap gap-1">
          {item.tags.map((tag) => (
            <span key={tag} className="rounded-lg bg-sage-100 px-2 py-0.5 text-[10px] font-bold text-sage-700">
              {tag}
            </span>
          ))}
          {item.allergens.map((code) => (
            <span key={code} className="rounded-lg bg-brand-100 px-2 py-0.5 text-[10px] font-bold text-brand-700">
              {ALLERGEN_LABEL[code] ?? code}
            </span>
          ))}
          {item.ocr_confidence !== 'high' && (
            <span className="rounded-lg bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
              판독 {item.ocr_confidence}
            </span>
          )}
        </div>
      </button>

      {loading && <p className="mt-2 text-xs text-muted">설명을 불러오는 중…</p>}
      {error && <p className="mt-2 text-xs text-brand-700">{error}</p>}

      {detail && (
        <div className="mt-3 border-t border-line pt-3">
          <p className="text-xs text-muted">
            {detail.romanization} · {detail.pronunciation_ko}
          </p>
          <p className="mt-2 text-sm leading-relaxed">{detail.description}</p>
          {detail.tip && <p className="mt-2 text-xs text-sage-700">💡 {detail.tip}</p>}

          {detail.allergens.length > 0 && (
            <div className="mt-3 rounded-xl bg-brand-100 p-2">
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

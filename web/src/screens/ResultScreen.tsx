import { useCallback, useMemo, useState } from 'react'
import { Navigate } from 'react-router'
import { ApiError, explainItem } from '../lib/api'
import { useApp } from '../store/app'
import {
  ALLERGEN_LABEL,
  type ExplainResponse,
  type MenuItem,
  type MenuScanResponse,
} from '../types/api'

/** 분류가 이 개수를 넘으면 접힌 채로 시작한다. 90개짜리 회전초밥 메뉴판을 다 펼쳐두면
 *  훑어보기가 불가능하고, 반대로 6개짜리를 접어두면 클릭만 늘어난다. */
const AUTO_COLLAPSE_OVER = 20

/** 메뉴판에 적힌 분류대로 묶는다. 등장 순서를 유지해야 메뉴판을 보는 순서와 같아진다. */
function groupBySection(items: MenuItem[]) {
  const groups: { section: string; items: MenuItem[] }[] = []
  for (const item of items) {
    const section = item.section || ''
    const existing = groups.find((g) => g.section === section)
    if (existing) existing.items.push(item)
    else groups.push({ section, items: [item] })
  }
  return groups
}

/** ⚠️ 아직 목업 디자인이 입혀지지 않은 화면이다(Phase 2d 예정). */
export function ResultScreen() {
  const scan = useApp((s) => s.scan)
  // 훅 호출 순서를 지키려고 가드를 분리한다.
  return scan ? <Result scan={scan} /> : <Navigate to="/" replace />
}

function Result({ scan }: { scan: MenuScanResponse }) {
  const groups = useMemo(() => groupBySection(scan.items), [scan.items])
  // 분류가 하나뿐이거나 아예 없는 메뉴판이면 헤더를 만들지 않는다(불필요한 장식).
  const hasSections = groups.length > 1

  const [collapsed, setCollapsed] = useState<Set<string>>(() =>
    hasSections && scan.items.length > AUTO_COLLAPSE_OVER
      ? new Set(groups.slice(1).map((g) => g.section))
      : new Set(),
  )

  const toggle = (section: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (!next.delete(section)) next.add(section)
      return next
    })

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

      {hasSections && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setCollapsed(new Set())}
            className="rounded-full border border-line bg-white px-3 py-1.5 text-[11px] font-bold text-[#6a564a]"
          >
            모두 펼치기
          </button>
          <button
            type="button"
            onClick={() => setCollapsed(new Set(groups.map((g) => g.section)))}
            className="rounded-full border border-line bg-white px-3 py-1.5 text-[11px] font-bold text-[#6a564a]"
          >
            모두 접기
          </button>
        </div>
      )}

      {groups.map((group) => {
        const isCollapsed = collapsed.has(group.section)
        return (
          <section key={group.section || '__none__'} className="flex flex-col gap-3">
            {hasSections && (
              <button
                type="button"
                onClick={() => toggle(group.section)}
                aria-expanded={!isCollapsed}
                className="flex items-center gap-2 pt-1 text-left"
              >
                <span className="text-[12.5px] font-extrabold text-brand-700">
                  {group.section || '기타'}
                </span>
                <span className="text-[11px] text-muted">{group.items.length}</span>
                <span className="ml-auto text-muted transition-transform" aria-hidden>
                  <svg
                    viewBox="0 0 24 24"
                    width="16"
                    height="16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={isCollapsed ? '' : 'rotate-180'}
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </span>
              </button>
            )}

            {!isCollapsed &&
              group.items.map((item, index) => (
                <MenuCard
                  key={`${item.name_local}-${index}`}
                  item={item}
                  sourceLang={scan.source_lang}
                  cuisineHint={scan.restaurant.cuisine_hint}
                />
              ))}
          </section>
        )
      })}
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

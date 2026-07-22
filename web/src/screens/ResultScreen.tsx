import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router'
import { CartBar } from '../components/CartBar'
import { MenuCard } from '../components/MenuCard'
import { cartLines } from '../lib/cart'
import { rateNow, refreshRate } from '../lib/fx'
import { useApp } from '../store/app'
import type { MenuItem, MenuScanResponse } from '../types/api'

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

export function ResultScreen() {
  const scan = useApp((s) => s.scan)
  // 훅 호출 순서를 지키려고 가드를 분리한다.
  return scan ? <Result scan={scan} /> : <Navigate to="/" replace />
}

function Result({ scan }: { scan: MenuScanResponse }) {
  const cart = useApp((s) => s.cart)
  const groups = useMemo(() => groupBySection(scan.items), [scan.items])
  // 분류가 하나뿐이거나 아예 없는 메뉴판이면 헤더를 만들지 않는다(불필요한 장식).
  const hasSections = groups.length > 1

  // 캐시/폴백 값으로 즉시 그리고, 하루 지났으면 조용히 갱신한다.
  const [rate, setRate] = useState<number | null>(() => rateNow(scan.currency))
  useEffect(() => {
    let alive = true
    refreshRate(scan.currency).then((r) => {
      if (alive) setRate(r)
    })
    return () => {
      alive = false
    }
  }, [scan.currency])

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

  const lines = useMemo(() => cartLines(scan.items, cart), [scan.items, cart])

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex flex-col gap-3 p-4">
        <div>
          <h2 className="font-local text-lg font-extrabold">
            {scan.restaurant.name_local || '가게 이름 미인식'}
          </h2>
          <p className="text-xs text-muted">
            {[scan.restaurant.cuisine_hint, `${scan.items.length}개 인식`]
              .filter(Boolean)
              .join(' · ')}
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
                  <span className="ml-auto text-muted" aria-hidden>
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
                    rate={rate}
                  />
                ))}
            </section>
          )
        })}
      </div>

      <div className="sticky bottom-0 mt-auto">
        <CartBar lines={lines} currency={scan.currency} rate={rate} />
      </div>
    </div>
  )
}

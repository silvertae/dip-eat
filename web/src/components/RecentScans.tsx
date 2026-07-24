import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { listRecents, type RecentScan } from '../lib/db'
import { useApp } from '../store/app'

/** 홈의 "최근 식당" — IndexedDB 에 저장된 지난 스캔을 최신순으로 보여준다.
 *  오프라인에서도 뜬다(스캔 결과·축소 이미지가 로컬에 있으므로). 없으면 아무것도 안 그린다. */
export function RecentScans() {
  const [recents, setRecents] = useState<RecentScan[] | null>(null)

  useEffect(() => {
    let alive = true
    listRecents()
      .then((r) => alive && setRecents(r))
      .catch(() => alive && setRecents([]))
    return () => {
      alive = false
    }
  }, [])

  if (!recents || recents.length === 0) return null

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[15px] font-extrabold">최근 식당</h2>
      {recents.map((entry) => (
        <RecentCard key={entry.scanId} entry={entry} />
      ))}
    </section>
  )
}

function RecentCard({ entry }: { entry: RecentScan }) {
  const navigate = useNavigate()
  const openRecent = useApp((s) => s.openRecent)
  const [thumb, setThumb] = useState<string | null>(null)

  // 썸네일 objectURL 은 카드가 살아있는 동안만 유지하고 언마운트 때 놓아준다(누수 방지).
  useEffect(() => {
    if (!entry.image) return
    const url = URL.createObjectURL(entry.image)
    setThumb(url)
    return () => URL.revokeObjectURL(url)
  }, [entry.image])

  const open = async () => {
    // 기록이 사라졌으면(다른 탭이 정리) 엉뚱한(직전) 식당을 열지 않도록 이동을 취소한다.
    if (await openRecent(entry.scanId)) navigate('/result')
  }

  const name = entry.scan.restaurant.name_local || '이름 미인식'

  return (
    <button
      type="button"
      onClick={open}
      className="flex items-center gap-3 rounded-2xl border border-line bg-white p-3 text-left"
    >
      {thumb ? (
        <img src={thumb} alt="" className="size-12 shrink-0 rounded-xl object-cover" />
      ) : (
        <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-brand-100 font-local text-lg font-extrabold text-brand-700">
          {name.slice(0, 1)}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-local text-[15px] font-extrabold">{name}</p>
        <p className="mt-0.5 text-xs text-muted">
          {entry.scan.items.length}개 · {timeAgo(entry.savedAt)}
        </p>
      </div>
      <span className="text-muted" aria-hidden>
        ›
      </span>
    </button>
  )
}

function timeAgo(at: number): string {
  const s = Math.max(0, Date.now() - at) / 1000
  if (s < 60) return '방금 전'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}분 전`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}시간 전`
  return `${Math.floor(h / 24)}일 전`
}

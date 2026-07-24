import { type CSSProperties, useEffect, useRef, useState } from 'react'
import { locateItems, type LocateTarget } from '../lib/api'
import type { CartLine } from '../lib/cart'
import { getLocates, getRecent, mergeLocates } from '../lib/db'
import { boxToRect, clampPct } from '../lib/photoOverlay'
import { itemKey } from '../store/app'
import { useApp } from '../store/app'
import type { ItemBox, MenuItem, MenuScanResponse } from '../types/api'

/** 사진 컨테이너의 종횡비(aspect-[3/4] = width/height). boxToRect 에 그대로 넘긴다. */
const CONTAINER_ASPECT = 3 / 4

type Status = 'loading' | 'ready' | 'error' | 'no-image'

/**
 * 주문서 '사진에서 확인' 탭. 촬영 메뉴판 위에 장바구니 항목을 실제 위치(백엔드 좌표) 마커로
 * 오버레이하고, 아래에 번호 범례를 붙인다. 배경은 Gemini 가 스캔 때 본 것과 같은 축소 Blob 이라
 * 좌표(정규화, 세운 이미지 기준)가 EXIF 회전과 무관하게 맞는다.
 *
 * 좌표는 항목 속성(수량 무관)이라 scan_id 별로 IndexedDB 에 캐시 — 재열람·오프라인 재진입 시
 * 재호출하지 않는다. 없는 항목만 골라 요청한다.
 */
export function MenuPhotoHighlight({
  lines,
  scan,
}: {
  lines: CartLine[]
  scan: MenuScanResponse
}) {
  const storePreview = useApp((s) => s.preview)
  const [bgUrl, setBgUrl] = useState<string | null>(null)
  const [imageAspect, setImageAspect] = useState<number | null>(null)
  const [boxes, setBoxes] = useState<Record<string, ItemBox>>({})
  const [status, setStatus] = useState<Status>('loading')
  const [retry, setRetry] = useState(0)

  // 렌더마다 바뀌는 값을 effect deps 에 넣지 않으려고 ref 로 넘긴다(cartSig 가 실질 트리거).
  const linesRef = useRef(lines)
  linesRef.current = lines
  const previewRef = useRef(storePreview)
  previewRef.current = storePreview

  // 장바구니 구성(순서 = 번호)이 바뀌면 다시 계산. 수량 변화는 좌표에 영향 없어 제외.
  const cartSig = lines.map((l) => itemKey(l.item)).join('|')

  useEffect(() => {
    let cancelled = false
    const ac = new AbortController()
    let objectUrl: string | null = null

    async function run() {
      setStatus('loading')
      const currentLines = linesRef.current

      // 배경: Gemini 가 본 것과 같은 축소 Blob 이 있어야 좌표를 요청할 수 있다.
      const entry = await getRecent(scan.scan_id).catch(() => undefined)
      if (cancelled) return
      const blob = entry?.image ?? null
      if (blob) {
        objectUrl = URL.createObjectURL(blob)
        setBgUrl(objectUrl)
      } else {
        // Blob 이 없으면 위치를 못 찾는다. 표시용으로 store preview 라도 있으면 배경만 보여준다.
        setBgUrl(previewRef.current ?? null)
      }

      // 캐시된 좌표(현재 장바구니 항목만) 먼저 반영 — 오프라인·재진입에서 즉시 뜬다.
      const cached = await getLocates(scan.scan_id).catch(() => ({}) as Record<string, ItemBox>)
      if (cancelled) return
      const known: Record<string, ItemBox> = {}
      for (const l of currentLines) {
        const k = itemKey(l.item)
        if (cached[k]) known[k] = cached[k]
      }
      setBoxes(known)

      if (!blob) {
        setStatus('no-image')
        return
      }

      // 아직 좌표가 없는 항목만 요청한다(index 는 범례 번호와 동일한 1..N).
      const missing = currentLines
        .map((l, i) => ({ line: l, index: i + 1 }))
        .filter(({ line }) => !known[itemKey(line.item)])
      if (missing.length === 0) {
        setStatus('ready')
        return
      }

      try {
        const targets: LocateTarget[] = missing.map(({ line, index }) => ({
          index,
          name_local: line.item.name_local,
          section: line.item.section,
        }))
        const res = await locateItems(blob, targets, { signal: ac.signal })
        if (cancelled) return
        const indexToKey = new Map(currentLines.map((l, i) => [i + 1, itemKey(l.item)]))
        const add: Record<string, ItemBox> = {}
        for (const b of res.boxes) {
          const k = indexToKey.get(b.index)
          if (k) add[k] = b
        }
        await mergeLocates(scan.scan_id, add).catch(() => {})
        if (cancelled) return
        setBoxes((prev) => ({ ...prev, ...add }))
        setStatus('ready')
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return
        setStatus('error')
      }
    }

    void run()
    return () => {
      cancelled = true
      ac.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [scan.scan_id, cartSig, retry])

  if (lines.length === 0) {
    return (
      <p className="py-4 text-center text-[13px] text-muted">
        담은 메뉴가 없어요. 결과 화면에서 담아보세요.
      </p>
    )
  }

  // ready 인데 좌표를 못 찾은 항목이 있으면(못 찾음 or 캐시에 없음) 범례로 안내.
  const someUnlocated =
    status === 'ready' && lines.some((l) => !boxes[itemKey(l.item)]?.found)

  return (
    <div>
      <p className="mx-0.5 mb-[11px] text-[12.5px] leading-[1.55] text-muted">
        촬영한 메뉴판에서 <b className="font-bold text-ink">주문한 메뉴</b>를 강조했어요. 화면을
        보여주며 손가락으로 가리켜 보세요.
      </p>

      {bgUrl ? (
        <div className="relative aspect-[3/4] overflow-hidden rounded-[20px] border border-line bg-ink shadow-[0_10px_24px_-12px_rgba(60,25,10,.32)]">
          <img
            src={bgUrl}
            alt="촬영한 메뉴판"
            onLoad={(e) => setImageAspect(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)}
            onError={() => {
              setBgUrl(null)
              setStatus('no-image')
            }}
            className="absolute inset-0 size-full object-contain"
          />
          {/* 마커 대비 확보용 딤 그라데이션 */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[rgba(28,19,14,.06)] to-[rgba(28,19,14,.4)]" />

          {imageAspect != null &&
            lines.map((l, i) => {
              const box = boxes[itemKey(l.item)]
              if (!box || !box.found) return null
              return (
                <HighlightMarker
                  key={itemKey(l.item)}
                  box={box}
                  index={i + 1}
                  item={l.item}
                  qty={l.qty}
                  imageAspect={imageAspect}
                  order={i}
                />
              )
            })}

          {status === 'loading' && (
            <div className="absolute inset-0 grid place-items-center bg-black/25">
              <div className="flex items-center gap-2 rounded-full bg-black/65 px-3.5 py-2 text-[12.5px] font-bold text-white backdrop-blur-sm">
                <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                메뉴 위치를 찾는 중…
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="grid aspect-[3/4] place-items-center rounded-[20px] border border-line bg-appbg px-6 text-center text-[13px] leading-[1.6] text-muted">
          메뉴판 사진을 불러올 수 없어요.
          <br />
          아래 목록으로 확인해 주세요.
        </div>
      )}

      {status === 'error' && (
        <div className="mt-3 flex items-center justify-between rounded-[13px] border border-line bg-white px-[13px] py-[11px]">
          <span className="text-[12.5px] text-muted">메뉴 위치를 불러오지 못했어요</span>
          <button
            type="button"
            onClick={() => setRetry((n) => n + 1)}
            className="rounded-full bg-brand px-3 py-1.5 text-[12px] font-bold text-white"
          >
            다시 시도
          </button>
        </div>
      )}

      {status === 'no-image' && bgUrl && (
        <p className="mt-2 text-center text-[11.5px] text-muted">
          이 사진은 위치 표시를 지원하지 않아요. 아래 번호 목록으로 확인하세요.
        </p>
      )}

      {someUnlocated && (
        <p className="mt-2 text-center text-[11.5px] text-muted">
          위치를 못 찾은 메뉴는 아래 번호 목록에서 확인하세요.
        </p>
      )}

      <PhotoLegend lines={lines} />
    </div>
  )
}

function HighlightMarker({
  box,
  index,
  item,
  qty,
  imageAspect,
  order,
}: {
  box: ItemBox
  index: number
  item: MenuItem
  qty: number
  imageAspect: number
  order: number
}) {
  const rect = boxToRect(box, CONTAINER_ASPECT, imageAspect, 'contain')
  // 라벨이 컨테이너 밖으로 넘치지 않게: 위쪽 상자는 아래로, 오른쪽 상자는 왼쪽으로 뻗게 앵커한다.
  const labelBelow = rect.top < 12
  const rightHalf = rect.left + rect.width / 2 > 55
  const labelStyle: CSSProperties = {
    // 오른쪽 절반이면 상자 오른쪽 끝을 기준으로 왼쪽으로 뻗고, 아니면 왼쪽 끝 기준 오른쪽으로.
    ...(rightHalf
      ? { right: `${clampPct(100 - (rect.left + rect.width))}%` }
      : { left: `${clampPct(rect.left)}%` }),
    top: labelBelow ? `${rect.top + rect.height}%` : `${rect.top}%`,
    transform: labelBelow ? 'translateY(3px)' : 'translateY(calc(-100% - 3px))',
  }

  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{ animation: 'jm-bubble .28s ease-out both', animationDelay: `${order * 40}ms` }}
    >
      {/* 강조 사각형 — 실제 항목 위치. 컨테이너 overflow-hidden 이 크롭 밖을 잘라준다. */}
      <div
        className="absolute rounded-[9px] border-2 border-brand bg-[rgba(234,90,52,.24)]"
        style={{
          left: `${rect.left}%`,
          top: `${rect.top}%`,
          width: `${rect.width}%`,
          height: `${rect.height}%`,
        }}
      />
      {/* 번호원 — 상자 좌상단 모서리에 걸침 */}
      <div
        className="absolute grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-brand text-[12px] font-extrabold text-white shadow-[0_2px_8px_rgba(0,0,0,.4)]"
        style={{ left: `${clampPct(rect.left)}%`, top: `${clampPct(rect.top)}%` }}
      >
        {index}
      </div>
      {/* 라벨 pill — 상자 위(또는 아래)에 떠서 작은 상자에도 이름이 안 잘린다.
          박스는 이미 현지어 원문 위에 얹혀 있으니, 라벨은 한국인 사용자가 알아볼 한국어명으로
          보여준다(번역명이 비면 원문 폴백). */}
      <div
        className="absolute flex max-w-[72%] items-center gap-1 rounded-[7px] bg-ink/85 px-1.5 py-0.5"
        style={labelStyle}
      >
        <span className="truncate text-[11px] font-extrabold text-white">
          {item.name_translated || item.name_local}
        </span>
        <span className="shrink-0 rounded-full bg-brand px-1.5 text-[10px] font-extrabold text-white">
          ×{qty}
        </span>
      </div>
    </div>
  )
}

function PhotoLegend({ lines }: { lines: CartLine[] }) {
  return (
    <div className="mt-3 rounded-[15px] border border-line bg-white px-[3px] py-[5px]">
      {lines.map((l, i) => (
        <div
          key={itemKey(l.item)}
          className={`flex items-center gap-2.5 px-[11px] py-[9px] ${
            i < lines.length - 1 ? 'border-b border-line' : ''
          }`}
        >
          <span className="grid size-[22px] shrink-0 place-items-center rounded-full bg-brand-100 text-[12px] font-extrabold text-brand-700">
            {i + 1}
          </span>
          <span className="min-w-0 flex-1 text-[14px] font-bold">
            {l.item.name_translated}{' '}
            <span className="font-local text-[11.5px] font-semibold text-muted">
              {l.item.name_local}
            </span>
          </span>
          <b className="shrink-0 text-brand">×{l.qty}</b>
        </div>
      ))}
    </div>
  )
}

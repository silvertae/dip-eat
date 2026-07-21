import { useState } from 'react'
import { CaptureButton } from './features/capture/CaptureButton'
import { resizeForUpload } from './features/capture/resizeImage'
import { ApiError, scanMenu } from './lib/api'
import type { MenuScanResponse } from './types/api'

type Phase = { kind: 'idle' } | { kind: 'working'; step: string } | { kind: 'error'; message: string }

/** Phase 1 수직 슬라이스: 촬영 → 축소 → 업로드 → 구조화 결과.
 *  목업의 화면·컴포넌트는 Phase 2 에서 입힌다. 지금은 파이프라인이 진짜로 뚫리는지만 본다. */
export default function App() {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [result, setResult] = useState<MenuScanResponse | null>(null)
  const [stats, setStats] = useState<string>('')

  async function handlePick(file: File) {
    setResult(null)
    try {
      setPhase({ kind: 'working', step: '사진을 줄이는 중…' })
      const resized = await resizeForUpload(file)

      setPhase({ kind: 'working', step: '메뉴판을 읽는 중…' })
      const scanned = await scanMenu(resized.blob, { mode: 'poster' })

      setStats(
        `${kb(resized.originalBytes)} → ${kb(resized.blob.size)} · ${resized.width}×${resized.height}` +
          ` · ${scanned.meta.model} · ${scanned.meta.latency_ms}ms`,
      )
      setResult(scanned)
      setPhase({ kind: 'idle' })
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? `사진을 처리하지 못했어요. (${err.message})`
            : '알 수 없는 오류가 발생했어요.'
      setPhase({ kind: 'error', message })
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 p-4">
      <header className="flex items-center gap-2 pt-2">
        <span className="grid size-9 place-items-center rounded-xl bg-brand text-lg font-extrabold text-white">
          찍
        </span>
        <b className="text-xl">찍먹</b>
        <span className="ml-auto text-xs text-muted">vertical slice</span>
      </header>

      <CaptureButton onPick={handlePick} disabled={phase.kind === 'working'}>
        {phase.kind === 'working' ? phase.step : '메뉴판 찍기'}
      </CaptureButton>

      {phase.kind === 'error' && (
        <p className="rounded-2xl border border-brand-200 bg-brand-100 p-3 text-sm text-brand-700">
          {phase.message}
        </p>
      )}

      {stats && <p className="text-center text-[11px] text-muted">{stats}</p>}

      {result && <ScanResult data={result} />}
    </main>
  )
}

function ScanResult({ data }: { data: MenuScanResponse }) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="font-local text-lg font-extrabold">
          {data.restaurant.name_local || '가게 이름 미인식'}
        </h2>
        <p className="text-xs text-muted">
          {[data.restaurant.cuisine_hint, `${data.items.length}개 인식`, data.source_lang]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>

      {data.warnings.map((warning) => (
        <p key={warning} className="rounded-xl bg-amber-100 p-2 text-xs text-amber-700">
          {warning}
        </p>
      ))}

      {data.items.map((item, index) => (
        <article
          key={`${item.name_local}-${index}`}
          className="rounded-2xl border border-line bg-card p-3"
        >
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

          <p className="mt-2 text-xs leading-relaxed text-ink/70">{item.description}</p>

          <div className="mt-2 flex flex-wrap gap-1">
            {item.tags.map((tag) => (
              <span key={tag} className="rounded-lg bg-sage-100 px-2 py-0.5 text-[10px] font-bold text-sage-700">
                {tag}
              </span>
            ))}
            {item.ocr_confidence !== 'high' && (
              <span className="rounded-lg bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                판독 {item.ocr_confidence}
              </span>
            )}
          </div>

          {item.likely_allergens.length > 0 && (
            <div className="mt-2 rounded-xl bg-brand-100 p-2">
              <p className="text-[11px] font-bold text-brand-700">
                {item.likely_allergens.map((a) => a.label).join(' · ')} 들어 있을 수 있어요
              </p>
              {/* 식품 안전: 이건 메뉴판에서 읽은 사실이 아니라 AI 추정이다. 반드시 고지한다. */}
              <p className="mt-0.5 text-[10px] text-brand-700/80">
                AI 추정이에요. 알레르기가 있다면 점원에게 꼭 확인하세요.
              </p>
            </div>
          )}
        </article>
      ))}
    </section>
  )
}

function kb(bytes: number): string {
  return `${Math.round(bytes / 1024)}KB`
}

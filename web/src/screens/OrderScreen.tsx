import { useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { ApiError } from '../lib/api'
import { cartLines } from '../lib/cart'
import { QUICK_PHRASES, buildOrderCard } from '../lib/orderPhrases'
import { useApp } from '../store/app'
import { useProfile } from '../store/profile'
import type { MenuScanResponse } from '../types/api'

export function OrderScreen() {
  const scan = useApp((s) => s.scan)
  return scan ? <Order scan={scan} /> : <Navigate to="/" replace />
}

function Order({ scan }: { scan: MenuScanResponse }) {
  const navigate = useNavigate()
  const cart = useApp((s) => s.cart)
  const dislikes = useProfile((s) => s.dislikes)

  const lines = useMemo(() => cartLines(scan.items, cart), [scan.items, cart])
  const card = useMemo(
    () => buildOrderCard(lines, scan.source_lang, dislikes),
    [lines, scan.source_lang, dislikes],
  )

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex flex-col gap-3 p-4">
        {/* ── 점원에게 보여줄 주문 카드 (오프라인, 서버 안 부름) ── */}
        <div className="rounded-[20px] border border-line bg-gradient-to-b from-white to-[#FFF3EC] p-[18px] shadow-[0_10px_24px_-12px_rgba(234,90,52,.28)]">
          {card.intro ? (
            <>
              <p className="text-center font-local text-[21px] font-extrabold tracking-wide">
                {card.intro.local}
              </p>
              <p className="mt-1 text-center text-[12.5px] text-muted">
                저기요, 주문할게요 · {card.intro.reading}
              </p>
            </>
          ) : (
            // 정적 문구가 없는 언어. 아래 대화로 전하도록 안내한다.
            <p className="text-center text-[13px] text-muted">
              이 언어의 주문 문구는 아직 준비 중이에요.
              <br />
              아래 항목을 점원에게 보여주세요.
            </p>
          )}

          {lines.length === 0 ? (
            <p className="py-2 text-center text-[13px] text-muted">
              담은 메뉴가 없어요. 결과 화면에서 담아보세요.
            </p>
          ) : (
            <div className="mt-3">
              {lines.map((l, i) => (
                <div
                  key={`${l.item.name_local}-${i}`}
                  className="flex items-center justify-between border-b border-dashed border-line py-2.5"
                >
                  <span className="font-local text-[15px] font-semibold">{l.item.name_local}</span>
                  <span className="font-extrabold text-brand">×{l.qty}</span>
                </div>
              ))}
            </div>
          )}

          {card.memos.map((memo) => (
            <div
              key={memo.local}
              className="mt-3 rounded-[13px] border border-[#F3E4C4] bg-[#FFF7E9] p-[11px]"
            >
              <p className="font-local text-[15px] font-bold">{memo.local}</p>
              <p className="mt-1 text-[11.5px] text-muted">{memo.ko} (비선호 자동 반영)</p>
            </div>
          ))}
        </div>

        {/* ── 점원과 대화 ── */}
        <div className="flex items-center gap-2 pt-1">
          <b className="text-[13.5px]">점원과 대화</b>
          <span className="text-[11.5px] text-muted">· 자유롭게 입력하면 번역해드려요</span>
        </div>

        <ChatThread sourceLang={scan.source_lang} />
      </div>

      {/* 주문 확정 → 완료 화면(Phase 4d). 결제는 범위 제외. */}
      <div className="sticky bottom-0 mt-auto border-t border-line bg-white px-4 pb-[13px] pt-[11px]">
        <button
          type="button"
          disabled={lines.length === 0}
          onClick={() => navigate('/done')}
          className="w-full rounded-[15px] bg-brand px-4 py-3.5 text-[15px] font-extrabold text-white disabled:opacity-40"
        >
          주문 확정
        </button>
      </div>
    </div>
  )
}

function ChatThread({ sourceLang }: { sourceLang: string }) {
  const convo = useApp((s) => s.convo)
  const pushBubble = useApp((s) => s.pushBubble)
  const sendChat = useApp((s) => s.sendChat)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  const quick = QUICK_PHRASES.filter((q) => q.byLang[sourceLang])

  async function send() {
    const trimmed = text.trim()
    if (!trimmed || sending) return
    setText('')
    setError('')
    setSending(true)
    try {
      await sendChat(trimmed, 'ko2local', sourceLang)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '번역하지 못했어요.')
      setText(trimmed) // 실패하면 입력을 되돌려준다
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {convo.map((b, i) =>
        b.from === 'them' ? (
          <div
            key={i}
            className="max-w-[82%] self-start rounded-2xl rounded-bl-[5px] border border-line bg-white px-[13px] py-[11px]"
          >
            <p className="font-local text-[11px] text-muted">{b.local}</p>
            <p className="text-[16px] font-extrabold leading-[1.35]">{b.ko}</p>
          </div>
        ) : (
          <div
            key={i}
            className="max-w-[82%] self-end rounded-2xl rounded-br-[5px] bg-ink px-[13px] py-[11px] text-white"
          >
            <p className="font-local text-[16px] font-extrabold leading-[1.35]">{b.local}</p>
            <p className="mt-1 text-[11px] opacity-70">
              {b.ko}
              {b.reading ? ` · ${b.reading}` : ''}
            </p>
          </div>
        ),
      )}

      {/* 빠른 응답 — 미리 번역돼 있어 바로 점원에게 보여줄 수 있다 */}
      {quick.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {quick.map((q) => (
            <button
              key={q.ko}
              type="button"
              onClick={() =>
                pushBubble({ from: 'me', ko: q.ko, ...q.byLang[sourceLang] })
              }
              className="rounded-full border border-line bg-white px-[13px] py-2 text-[12.5px] font-bold text-[#6a564a]"
            >
              {q.ko}
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-xs text-brand-700">{error}</p>}

      <div className="flex gap-2 pt-1">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="한국어로 입력…"
          className="min-w-0 flex-1 rounded-full border border-line bg-white px-4 py-2.5 text-sm"
        />
        <button
          type="button"
          onClick={send}
          disabled={sending || !text.trim()}
          className="shrink-0 rounded-full bg-brand px-4 text-sm font-bold text-white disabled:opacity-40"
        >
          {sending ? '…' : '전달'}
        </button>
      </div>
    </div>
  )
}

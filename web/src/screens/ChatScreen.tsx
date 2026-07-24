import { useMemo } from 'react'
import { Link, Navigate } from 'react-router'
import { PushToTalkToggle } from '../components/PushToTalkToggle'
import { OrderIcon } from '../components/icons'
import { cartLines, cartTotals } from '../lib/cart'
import { formatLocal } from '../lib/fx'
import { QUICK_PHRASES } from '../lib/orderPhrases'
import { useApp } from '../store/app'
import type { MenuScanResponse } from '../types/api'

export function ChatScreen() {
  const scan = useApp((s) => s.scan)
  return scan ? <Chat scan={scan} /> : <Navigate to="/" replace />
}

function Chat({ scan }: { scan: MenuScanResponse }) {
  const cart = useApp((s) => s.cart)
  const convo = useApp((s) => s.convo)
  const pushBubble = useApp((s) => s.pushBubble)

  const { count, localTotal } = useMemo(
    () => cartTotals(cartLines(scan.items, cart)),
    [scan.items, cart],
  )
  const quick = QUICK_PHRASES.filter((q) => q.byLang[scan.source_lang])

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex-1 p-4">
        <header className="mb-3">
          <h1 className="text-[20px] font-extrabold -tracking-[0.3px]">점원과 대화</h1>
          <p className="mt-[3px] text-xs text-muted">메뉴·장바구니를 아는 실시간 통역</p>
        </header>

        {/* 주문서 요약 → /order */}
        <Link
          to="/order"
          className="mb-3.5 flex items-center gap-[11px] rounded-[14px] border border-line bg-white px-[13px] py-[11px]"
        >
          <span className="grid size-[34px] shrink-0 place-items-center rounded-[10px] bg-brand-100 text-brand-700">
            <OrderIcon size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-extrabold">주문서 보기</span>
            <span className="block text-[11.5px] text-muted">
              {count}개 · {formatLocal(localTotal, scan.currency)}
            </span>
          </span>
          <span className="text-lg text-muted">›</span>
        </Link>

        {/* 말풍선 */}
        {convo.map((b, i) =>
          b.from === 'them' ? (
            <div
              key={i}
              className="mb-[9px] max-w-[82%] rounded-2xl rounded-bl-[5px] border border-line bg-white px-[13px] py-[11px] [animation:jm-bubble_.25s_ease]"
            >
              <p className="mb-[3px] font-local text-[11px] text-muted">{b.local}</p>
              <p className="text-[16px] font-extrabold leading-[1.35]">{b.ko}</p>
            </div>
          ) : (
            <div
              key={i}
              className="mb-[9px] ml-auto max-w-[82%] rounded-2xl rounded-br-[5px] bg-ink px-[13px] py-[11px] text-white [animation:jm-bubble_.25s_ease]"
            >
              <p className="font-local text-[16px] font-extrabold leading-[1.35]">{b.local}</p>
              <p className="mt-[3px] text-[11px] opacity-70">
                {b.ko}
                {b.reading ? ` · ${b.reading}` : ''}
              </p>
            </div>
          ),
        )}

        {/* 빠른 응답 — 미리 번역돼 있어 오프라인에서도 점원에게 보여줄 수 있다 */}
        {quick.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-[7px]">
            {quick.map((q) => (
              <button
                key={q.ko}
                type="button"
                onClick={() => pushBubble({ from: 'me', ko: q.ko, ...q.byLang[scan.source_lang] })}
                className="rounded-full border border-line bg-white px-[13px] py-2 text-[12.5px] font-bold text-[#6a564a]"
              >
                {q.ko}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* push-to-talk */}
      <div className="sticky bottom-0 border-t border-line bg-white px-4 pb-[13px] pt-[11px]">
        <PushToTalkToggle sourceLang={scan.source_lang} />
      </div>
    </div>
  )
}

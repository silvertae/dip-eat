import { useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { ChatIcon } from '../components/icons'
import { MenuPhotoHighlight } from '../components/MenuPhotoHighlight'
import { cartLines } from '../lib/cart'
import { formatHome, formatLocal, rateNow } from '../lib/fx'
import { buildOrderCard } from '../lib/orderPhrases'
import { tr } from '../lib/i18n'
import { useApp } from '../store/app'
import { useProfile } from '../store/profile'
import type { MenuScanResponse } from '../types/api'
import { homeCurrencyFor } from '../types/locale'

export function OrderScreen() {
  const scan = useApp((s) => s.scan)
  return scan ? <Order scan={scan} /> : <Navigate to="/" replace />
}

function Order({ scan }: { scan: MenuScanResponse }) {
  const navigate = useNavigate()
  const cart = useApp((s) => s.cart)
  const { dislikes, travelerLang } = useProfile()
  const homeCurrency = homeCurrencyFor(travelerLang)
  const [orderTab, setOrderTab] = useState<'card' | 'photo'>('card')

  const lines = useMemo(() => cartLines(scan.items, cart), [scan.items, cart])
  const card = useMemo(
    () => buildOrderCard(lines, scan.source_lang, dislikes, travelerLang),
    [lines, scan.source_lang, dislikes, travelerLang],
  )
  const rate = rateNow(scan.currency, homeCurrency)
  const homeTotal = rate != null ? card.localTotal * rate : null

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex-1 p-4">
        <header className="mb-3">
          <h1 className="text-[20px] font-extrabold -tracking-[0.3px]">
            {tr(travelerLang, { ko: '주문서', ja: '注文カード' })}
          </h1>
          <p className="mt-[3px] text-xs text-muted">
            {tr(travelerLang, { ko: '이 화면을 그대로 점원에게 보여주세요', ja: 'この画面を店員に見せてください' })}
          </p>
        </header>

        {/* 주문 카드 ↔ 사진에서 확인 전환 */}
        <div className="mb-3 flex gap-[7px]">
          <button
            type="button"
            onClick={() => setOrderTab('card')}
            className={`rounded-full px-[13px] py-2 text-xs font-bold ${
              orderTab === 'card'
                ? 'bg-ink text-white'
                : 'border border-line bg-white text-[#6a564a]'
            }`}
          >
            {tr(travelerLang, { ko: '주문 카드', ja: '注文カード' })}
          </button>
          <button
            type="button"
            onClick={() => setOrderTab('photo')}
            className={`rounded-full px-[13px] py-2 text-xs font-bold ${
              orderTab === 'photo'
                ? 'bg-ink text-white'
                : 'border border-line bg-white text-[#6a564a]'
            }`}
          >
            {tr(travelerLang, { ko: '사진에서 확인', ja: '写真で確認' })}
          </button>
        </div>

        {orderTab === 'photo' ? (
          <MenuPhotoHighlight lines={lines} scan={scan} />
        ) : (
          <>
        {/* 점원에게 보여줄 주문 카드 (오프라인, 서버 안 부름) */}
        <div className="rounded-[20px] border border-line bg-gradient-to-b from-white to-[#FFF3EC] p-[18px] shadow-[0_10px_24px_-12px_rgba(234,90,52,.28)]">
          {card.intro ? (
            <>
              <p className="text-center font-local text-[21px] font-extrabold tracking-wide">
                {card.intro.local}
              </p>
              <p className="mt-1 text-center text-[12.5px] text-muted">
                {tr(travelerLang, { ko: '저기요, 주문할게요', ja: '店員への呼びかけ・注文' })}
              </p>
            </>
          ) : (
            <p className="text-center text-[13px] text-muted">
              {tr(travelerLang, { ko: '이 언어의 주문 문구는 아직 준비 중이에요.', ja: 'この言語の注文フレーズは準備中です。' })}
              <br />
              {tr(travelerLang, { ko: '아래 항목을 점원에게 보여주세요.', ja: '下の商品名を店員に見せてください。' })}
            </p>
          )}

          {lines.length === 0 ? (
            <p className="py-2 text-center text-[13px] text-muted">
              {tr(travelerLang, { ko: '담은 메뉴가 없어요. 결과 화면에서 담아보세요.', ja: '選んだ料理がありません。結果画面から追加してください。' })}
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
              <p className="mt-1 text-[11.5px] text-muted">
                {memo.ko} ({tr(travelerLang, { ko: '비선호 자동 반영', ja: '苦手な食材を自動反映' })})
              </p>
            </div>
          ))}
        </div>

        {/* 합계 */}
        <div className="mt-3.5 flex items-center justify-between rounded-[15px] border border-line bg-white px-[15px] py-[13px]">
          <span className="text-[12.5px] text-muted">
            {tr(travelerLang, { ko: `합계 ${card.count}개`, ja: `合計 ${card.count}点` })}
          </span>
          <b className="text-[15px]">
            {formatLocal(card.localTotal, scan.currency)}
            {homeTotal != null && scan.currency !== homeCurrency && (
              <span className="ml-1 text-[11px] font-semibold text-muted">
                {formatHome(homeTotal, homeCurrency)}
              </span>
            )}
          </b>
        </div>

        {card.missingPrice > 0 && (
          <p className="mt-2 text-[11px] text-amber-700">
            {tr(travelerLang, {
              ko: `가격을 읽지 못한 ${card.missingPrice}개는 합계에서 빠졌어요`,
              ja: `価格を読み取れなかった${card.missingPrice}点は合計に含まれていません`,
            })}
          </p>
        )}
          </>
        )}
      </div>

      {/* 대화 화면으로 */}
      <div className="sticky bottom-0 border-t border-line bg-white px-4 pb-[13px] pt-[11px]">
        <button
          type="button"
          onClick={() => navigate('/chat')}
          className="flex w-full items-center justify-center gap-[9px] rounded-[15px] bg-brand px-4 py-3.5 text-[15px] font-extrabold text-white shadow-[0_12px_22px_-8px_rgba(234,90,52,.55)]"
        >
          <ChatIcon size={19} />
          {tr(travelerLang, { ko: '점원과 대화하기', ja: '店員と会話する' })}
        </button>
      </div>
    </div>
  )
}

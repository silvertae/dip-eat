import { NavLink } from 'react-router'
import { CameraIcon, ChatIcon, OrderIcon, SettingsIcon } from './icons'
import { tr, type LocalizedText } from '../lib/i18n'
import { useProfile } from '../store/profile'

/** 목업의 4탭. 주문서·대화는 독립 화면(서로 CTA 로 오간다). */
const TABS: { label: LocalizedText; to: string; Icon: typeof CameraIcon }[] = [
  { label: { ko: '사진인식', ja: 'スキャン' }, to: '/', Icon: CameraIcon },
  { label: { ko: '주문서', ja: '注文' }, to: '/order', Icon: OrderIcon },
  { label: { ko: '대화', ja: '会話' }, to: '/chat', Icon: ChatIcon },
  { label: { ko: '설정', ja: '設定' }, to: '/settings', Icon: SettingsIcon },
]

export function TabBar() {
  const travelerLang = useProfile((s) => s.travelerLang)
  return (
    <nav className="flex h-[82px] shrink-0 items-start justify-around border-t border-line bg-white pt-2">
      {TABS.map(({ label, to, Icon }) => (
        <NavLink
          key={to}
          to={to}
          end
          className={({ isActive }) =>
            `flex flex-col items-center gap-1 px-3 text-[10px] font-bold ${
              isActive ? 'text-brand' : 'text-[#B7A695]'
            }`
          }
        >
          <Icon size={23} />
          {tr(travelerLang, label)}
        </NavLink>
      ))}
    </nav>
  )
}

import { NavLink } from 'react-router'
import { CameraIcon, ChatIcon, OrderIcon, SettingsIcon } from './icons'

/** 목업의 4탭. 주문서·대화는 독립 화면(서로 CTA 로 오간다). */
const TABS: { label: string; to: string; Icon: typeof CameraIcon }[] = [
  { label: '사진인식', to: '/', Icon: CameraIcon },
  { label: '주문서', to: '/order', Icon: OrderIcon },
  { label: '대화', to: '/chat', Icon: ChatIcon },
  { label: '설정', to: '/settings', Icon: SettingsIcon },
]

export function TabBar() {
  return (
    <nav className="flex h-[82px] shrink-0 items-start justify-around border-t border-line bg-white pt-2">
      {TABS.map(({ label, to, Icon }) => (
        <NavLink
          key={label}
          to={to}
          end
          className={({ isActive }) =>
            `flex flex-col items-center gap-1 px-3 text-[10px] font-bold ${
              isActive ? 'text-brand' : 'text-[#B7A695]'
            }`
          }
        >
          <Icon size={23} />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}

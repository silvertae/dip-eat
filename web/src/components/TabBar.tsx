import { NavLink } from 'react-router'
import { CameraIcon, ChatIcon, OrderIcon, SettingsIcon } from './icons'

/** 목업의 4탭. 아직 화면이 없는 탭은 흐리게 두고 동작하지 않는다.
 *  (해당 Phase 에서 `to` 만 채우면 살아난다) */
const TABS = [
  { label: '사진인식', to: '/', Icon: CameraIcon },
  { label: '주문서', to: null, Icon: OrderIcon },
  { label: '대화', to: null, Icon: ChatIcon },
  { label: '설정', to: '/settings', Icon: SettingsIcon },
] as const

export function TabBar() {
  return (
    <nav className="flex h-[82px] shrink-0 items-start justify-around border-t border-line bg-white pt-2">
      {TABS.map(({ label, to, Icon }) =>
        to ? (
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
        ) : (
          <span
            key={label}
            aria-disabled
            className="flex flex-col items-center gap-1 px-3 text-[10px] font-bold text-[#B7A695] opacity-40"
          >
            <Icon size={23} />
            {label}
          </span>
        ),
      )}
    </nav>
  )
}

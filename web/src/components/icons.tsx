/** 목업에서 쓰는 아이콘만. 아이콘 라이브러리를 추가하지 않는다(번들·의존성). */

type Props = { size?: number; className?: string }

const base = (size: number) => ({
  viewBox: '0 0 24 24',
  width: size,
  height: size,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
})

export const CameraIcon = ({ size = 22, className }: Props) => (
  <svg {...base(size)} className={className}>
    <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z" />
    <circle cx="12" cy="13" r="3.2" />
  </svg>
)

export const ImageIcon = ({ size = 22, className }: Props) => (
  <svg {...base(size)} className={className}>
    <rect x="3" y="3" width="18" height="18" rx="3" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-3.6-3.6a2 2 0 0 0-2.8 0L4 22" />
  </svg>
)

export const OrderIcon = ({ size = 22, className }: Props) => (
  <svg {...base(size)} className={className}>
    <path d="M5 3h11a1 1 0 0 1 1 1v17l-3-2-2 2-2-2-2 2-3-2V4a1 1 0 0 1 1-1Z" />
    <path d="M8 7h6M8 11h5" />
  </svg>
)

export const ChatIcon = ({ size = 22, className }: Props) => (
  <svg {...base(size)} className={className}>
    <path d="M7.9 20A9 9 0 1 0 4 16.1L2.5 21.5Z" />
  </svg>
)

export const SettingsIcon = ({ size = 22, className }: Props) => (
  <svg {...base(size)} className={className}>
    <path d="M4 6h9M18 6h2M4 12h2M11 12h9M4 18h7M16 18h4" />
    <circle cx="16" cy="6" r="2" />
    <circle cx="9" cy="12" r="2" />
    <circle cx="14" cy="18" r="2" />
  </svg>
)

export const GearIcon = ({ size = 22, className }: Props) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
  </svg>
)

export const BackIcon = ({ size = 20, className }: Props) => (
  <svg {...base(size)} className={className}>
    <path d="m15 18-6-6 6-6" />
  </svg>
)

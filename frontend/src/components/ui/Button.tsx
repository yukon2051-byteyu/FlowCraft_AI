import type { ReactNode } from 'react'
import { Link } from 'react-router'

/**
 * 製品全体で使う共通ボタン。見た目の種類（variant）をここで一元管理する。
 *
 * 暗い面の上：
 *   - primary     ：その画面で一番押してほしい操作（ミント）
 *   - light       ：重要だが主役ではない操作（白）
 *   - outlineDark ：補助操作（白枠）
 *   - ghostDark   ：ツールバーなど控えめな操作
 * 明るい面の上：
 *   - primary     ：（同上・ミント）
 *   - dark        ：重要だが主役ではない操作（濃色）
 *   - secondary   ：補助操作（白地＋枠）
 *   - ghost       ：控えめな操作
 *   - danger      ：削除などの取り消せない操作
 */
export type ButtonVariant = 'primary' | 'light' | 'outlineDark' | 'ghostDark' | 'dark' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

const base =
  'inline-flex items-center justify-center gap-2 rounded-full font-bold whitespace-nowrap transition-colors duration-150 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mint select-none'

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-mint text-on-mint shadow-[0_0_0_1px_rgba(56,217,173,0.4),0_8px_24px_-8px_rgba(56,217,173,0.55)] hover:bg-mint-hover',
  light: 'bg-white text-ink hover:bg-card',
  outlineDark: 'text-white ring-1 ring-inset ring-white/25 hover:bg-white/8 hover:ring-white/50',
  ghostDark: 'text-subtle hover:bg-white/8 hover:text-white',
  dark: 'bg-ink text-white hover:bg-[#25332f] focus-visible:outline-forest',
  secondary: 'bg-paper text-ink ring-1 ring-inset ring-line hover:ring-forest/50 hover:bg-mint-soft/50 focus-visible:outline-forest',
  ghost: 'text-ink hover:bg-ink/6 focus-visible:outline-forest',
  danger: 'bg-error-ink text-white hover:bg-[#962e2e] focus-visible:outline-error',
}

const sizes: Record<ButtonSize, string> = {
  sm: 'h-9 px-4 text-[0.9rem]',
  md: 'h-11 px-5 text-[0.95rem]',
  lg: 'h-13 px-7 text-[1.05rem]',
}

const disabledStyle = 'opacity-40 cursor-not-allowed pointer-events-none shadow-none'

type Props = {
  children: ReactNode
  variant?: ButtonVariant
  size?: ButtonSize
  className?: string
  /** 画面内の移動（react-router） */
  to?: string
  /** ページ内リンク・外部リンク */
  href?: string
  onClick?: () => void
  disabled?: boolean
  /** 押せない理由など。マウスを重ねると表示される */
  title?: string
  type?: 'button' | 'submit'
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  to,
  href,
  onClick,
  disabled = false,
  title,
  type = 'button',
}: Props) {
  const cls = `${base} ${variants[variant]} ${sizes[size]} ${disabled ? disabledStyle : ''} ${className}`

  if (disabled) {
    // 押せない状態は <button disabled> にする。理由は title と周囲の文言で伝える
    return (
      <span title={title} className="inline-flex cursor-not-allowed">
        <button type={type} className={cls} disabled aria-disabled>
          {children}
        </button>
      </span>
    )
  }
  if (to) {
    return (
      <Link to={to} className={cls} title={title}>
        {children}
      </Link>
    )
  }
  if (href) {
    return (
      <a href={href} className={cls} title={title}>
        {children}
      </a>
    )
  }
  return (
    <button type={type} className={cls} onClick={onClick} title={title}>
      {children}
    </button>
  )
}

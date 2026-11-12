import type { ReactNode } from 'react'
import { Link } from 'react-router'

/**
 * 製品全体で使う共通ボタン。
 * 見た目の種類（variant）をここで一元管理し、画面ごとに色や形がずれないようにする。
 *
 * - primary     ：その画面で一番押してほしい操作（緑）
 * - accent      ：主要だが「開始」以外の操作（青。例：フローを作成）
 * - secondary   ：明るい背景の上の補助操作（白地＋青枠）
 * - outlineDark ：ネイビー背景の上の補助操作（白枠）
 * - ghost       ：ツールバーなど控えめな操作
 */
export type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'outlineDark' | 'ghost'
export type ButtonSize = 'sm' | 'md' | 'lg'

const base =
  'inline-flex items-center justify-center gap-2 rounded-full font-bold whitespace-nowrap transition-colors duration-150 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 select-none'

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-success text-white shadow-sm hover:bg-[#106b49] focus-visible:outline-success',
  accent: 'bg-accent text-white shadow-sm hover:bg-accent-hover focus-visible:outline-accent',
  secondary:
    'bg-white text-accent ring-1 ring-inset ring-accent/40 hover:bg-accent-soft hover:ring-accent focus-visible:outline-accent',
  outlineDark: 'text-white ring-1 ring-inset ring-white/40 hover:bg-white/10 hover:ring-white/70 focus-visible:outline-white',
  ghost: 'text-ink hover:bg-surface focus-visible:outline-accent',
}

const sizes: Record<ButtonSize, string> = {
  sm: 'h-9 px-4 text-[0.9rem]',
  md: 'h-11 px-5 text-[0.95rem]',
  lg: 'h-13 px-7 text-[1.05rem]',
}

const disabledStyle = 'opacity-45 cursor-not-allowed pointer-events-none'

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

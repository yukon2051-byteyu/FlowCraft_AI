/** FlowCraft AI のロゴ（複数の表が1つの結果にまとまる様子を表したマーク）。 */
export function LogoMark({ className = 'size-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="7" fill="#2563A6" />
      <rect x="5" y="7" width="8" height="6" rx="1.5" fill="#FFFFFF" />
      <rect x="5" y="19" width="8" height="6" rx="1.5" fill="#FFFFFF" />
      <rect x="19" y="13" width="8" height="6" rx="1.5" fill="#7FD3AE" />
      <path d="M13 10 H16 V16 H19 M13 22 H16 V16" stroke="#FFFFFF" strokeWidth="1.6" fill="none" />
    </svg>
  )
}

export function Logo({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark />
      <span className={`text-[1.15rem] font-bold tracking-tight ${tone === 'light' ? 'text-white' : 'text-navy'}`}>
        FlowCraft <span className={tone === 'light' ? 'text-mint' : 'text-success'}>AI</span>
      </span>
    </span>
  )
}

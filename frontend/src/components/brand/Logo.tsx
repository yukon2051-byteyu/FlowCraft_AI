/** FlowCraft AI のロゴ（複数の表が1つの結果にまとまる様子を表したマーク）。 */
export function LogoMark({ className = 'size-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="8" fill="#38D9AD" />
      <rect x="5" y="7" width="8" height="6" rx="1.5" fill="#08201A" />
      <rect x="5" y="19" width="8" height="6" rx="1.5" fill="#08201A" />
      <rect x="19" y="13" width="8" height="6" rx="1.5" fill="#FFFFFF" />
      <path d="M13 10 H16 V16 H19 M13 22 H16 V16" stroke="#08201A" strokeWidth="1.8" fill="none" />
    </svg>
  )
}

export function Logo() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark />
      <span className="text-[1.15rem] font-bold tracking-tight text-white">
        FlowCraft <span className="text-mint">AI</span>
      </span>
    </span>
  )
}

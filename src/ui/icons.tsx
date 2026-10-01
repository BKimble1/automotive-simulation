/** Small line icons (inline SVG, currentColor). */
export const BackIcon = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
    <path d="M9.5 3.5 5 8l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
export const PlayIcon = ({ size = 11 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden>
    <path d="M3 1.6 L10.4 6 L3 10.4 Z" fill="currentColor" />
  </svg>
);
export const PauseIcon = ({ size = 11 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden>
    <rect x="2.4" y="1.8" width="2.6" height="8.4" rx="0.6" fill="currentColor" />
    <rect x="7" y="1.8" width="2.6" height="8.4" rx="0.6" fill="currentColor" />
  </svg>
);
export const PrevIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
    <path d="M9.5 2 4 6l5.5 4z M2.5 2v8" fill="currentColor" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
  </svg>
);
export const NextIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
    <path d="M2.5 2 8 6l-5.5 4z M9.5 2v8" fill="currentColor" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
  </svg>
);
export const ReplayIcon = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden>
    <path d="M2.5 7a4.5 4.5 0 1 0 1.4-3.3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M2 1.8v2.6h2.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
export const CloseIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
    <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);
export const SoundIcon = ({ off }: { off?: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
    <path d="M2.5 6h2.5l3.5-3v10l-3.5-3H2.5z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    {off ? <path d="M11 6l3 4M14 6l-3 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /> : <path d="M11 5.5c1.2 1.4 1.2 3.6 0 5M12.8 4c2 2.3 2 5.7 0 8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />}
  </svg>
);
export const CaptionIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
    <rect x="1.5" y="3" width="13" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
    <path d="M7 6.6a1.6 1.6 0 1 0 0 2.8M11.6 6.6a1.6 1.6 0 1 0 0 2.8" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);
export const InfoIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
    <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
    <path d="M8 7.2V11M8 5v.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);
export const KeyIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
    <path d="M2 4h3M2 8h3M2 12h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <path d="M7 4h7M7 8h5M7 12h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.6" />
  </svg>
);
export const SearchIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
    <circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

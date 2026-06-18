import BoringAvatar from "boring-avatars";

const PALETTE = ["#5b8cff", "#37d399", "#f4b740", "#f06363", "#a78bfa"];

// Styled profile icon (boring-avatars "beam"), deterministic from the id.
export function ProfileAvatar({ name, size = 40 }: { name: string; size?: number }) {
  return <BoringAvatar size={size} name={name || "anon"} variant="beam" colors={PALETTE} />;
}

// Country flag as a real icon (flagcdn), with a neutral globe icon fallback.
export function Flag({ cc, className = "" }: { cc?: string; className?: string }) {
  if (!cc || cc.length !== 2) return <GlobeIcon className={className} />;
  return (
    <img
      src={`https://flagcdn.com/20x15/${cc.toLowerCase()}.png`}
      width={20}
      height={15}
      alt={cc}
      loading="lazy"
      className={`inline-block rounded-[2px] align-middle ${className}`}
      onError={(e) => {
        (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
      }}
    />
  );
}

export function GlobeIcon({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={`inline-block align-middle text-sub ${className}`}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </svg>
  );
}

// Inline arrow icon (replaces the "→" glyph in flow displays).
export function ArrowIcon({ size = 14, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`inline-block align-middle ${className}`}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

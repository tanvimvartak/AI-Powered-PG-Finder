"use client";

/**
 * Charming flat-vector illustration of student accommodation with trees, sun and birds.
 * Matches the reference mockup styling.
 */
export default function ApartmentIllustration({ className = "w-full max-w-[280px] h-auto" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 300 135"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Warm terracotta sun */}
      <circle cx="230" cy="56" r="26" fill="#F08A5D" />

      {/* Flying birds */}
      <path
        d="M 248 24 Q 253 19 258 24 Q 263 19 268 24"
        fill="none"
        stroke="#1E5D4B"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M 262 40 Q 266 36 270 40 Q 274 36 278 40"
        fill="none"
        stroke="#1E5D4B"
        strokeWidth="1.8"
        strokeLinecap="round"
      />

      {/* Background trees left */}
      <circle cx="68" cy="85" r="24" fill="#6B9E87" />
      <circle cx="95" cy="76" r="28" fill="#A8C7B8" />
      <line x1="68" y1="85" x2="68" y2="124" stroke="#1E5D4B" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="95" y1="76" x2="95" y2="124" stroke="#1E5D4B" strokeWidth="2.5" strokeLinecap="round" />

      {/* Background trees right */}
      <circle cx="232" cy="78" r="26" fill="#4F8F74" />
      <circle cx="258" cy="88" r="20" fill="#7FA996" />
      <line x1="232" y1="78" x2="232" y2="124" stroke="#1E5D4B" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="258" y1="88" x2="258" y2="124" stroke="#1E5D4B" strokeWidth="2.5" strokeLinecap="round" />

      {/* Apartment Building Main Body */}
      <rect
        x="122"
        y="36"
        width="106"
        height="88"
        rx="2"
        fill="#FCFAF6"
        stroke="#1E5D4B"
        strokeWidth="2.5"
      />

      {/* Roof cornice */}
      <path d="M 118 36 L 232 36" stroke="#1E5D4B" strokeWidth="4" strokeLinecap="round" />
      <path d="M 120 40 L 230 40" stroke="#1E5D4B" strokeWidth="1.5" />

      {/* Center entrance / doorway */}
      <rect
        x="161"
        y="92"
        width="28"
        height="32"
        fill="#4F8F74"
        rx="1.5"
        stroke="#1E5D4B"
        strokeWidth="2"
      />
      <rect x="166" y="96" width="18" height="28" fill="#1E5D4B" rx="1" />

      {/* Center balcony / terrace */}
      <rect
        x="157"
        y="66"
        width="36"
        height="18"
        fill="#FFFFFF"
        stroke="#1E5D4B"
        strokeWidth="2"
      />
      {/* Balcony railings */}
      <line x1="163" y1="66" x2="163" y2="84" stroke="#1E5D4B" strokeWidth="1.5" />
      <line x1="169" y1="66" x2="169" y2="84" stroke="#1E5D4B" strokeWidth="1.5" />
      <line x1="175" y1="66" x2="175" y2="84" stroke="#1E5D4B" strokeWidth="1.5" />
      <line x1="181" y1="66" x2="181" y2="84" stroke="#1E5D4B" strokeWidth="1.5" />
      <line x1="187" y1="66" x2="187" y2="84" stroke="#1E5D4B" strokeWidth="1.5" />

      {/* Windows 3rd Floor */}
      <g stroke="#1E5D4B" strokeWidth="1.5" fill="#FFFFFF">
        <rect x="130" y="44" width="14" height="14" />
        <line x1="137" y1="44" x2="137" y2="58" />
        <line x1="130" y1="51" x2="144" y2="51" />

        <rect x="151" y="44" width="14" height="14" />
        <line x1="158" y1="44" x2="158" y2="58" />
        <line x1="151" y1="51" x2="165" y2="51" />

        <rect x="185" y="44" width="14" height="14" />
        <line x1="192" y1="44" x2="192" y2="58" />
        <line x1="185" y1="51" x2="199" y2="51" />

        <rect x="206" y="44" width="14" height="14" />
        <line x1="213" y1="44" x2="213" y2="58" />
        <line x1="206" y1="51" x2="220" y2="51" />
      </g>

      {/* Windows 2nd Floor */}
      <g stroke="#1E5D4B" strokeWidth="1.5" fill="#FFFFFF">
        <rect x="130" y="68" width="14" height="14" />
        <line x1="137" y1="68" x2="137" y2="82" />
        <line x1="130" y1="75" x2="144" y2="75" />

        <rect x="206" y="68" width="14" height="14" />
        <line x1="213" y1="68" x2="213" y2="82" />
        <line x1="206" y1="75" x2="220" y2="75" />
      </g>

      {/* Windows 1st Floor */}
      <g stroke="#1E5D4B" strokeWidth="1.5" fill="#FFFFFF">
        <rect x="130" y="92" width="14" height="14" />
        <line x1="137" y1="92" x2="137" y2="106" />
        <line x1="130" y1="99" x2="144" y2="99" />

        <rect x="206" y="92" width="14" height="14" />
        <line x1="213" y1="92" x2="213" y2="106" />
        <line x1="206" y1="99" x2="220" y2="99" />
      </g>

      {/* Front bushes left & right */}
      <circle cx="50" cy="115" r="10" fill="#4F8F74" />
      <circle cx="62" cy="112" r="14" fill="#3D7D62" />
      <circle cx="112" cy="116" r="12" fill="#6B9E87" />
      <circle cx="236" cy="116" r="11" fill="#4F8F74" />
      <circle cx="270" cy="115" r="9" fill="#3D7D62" />

      {/* Ground horizontal line */}
      <line x1="15" y1="124" x2="285" y2="124" stroke="#1E5D4B" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

// Verbatim port from components/beadbox-logo.tsx (P2.3 / bb-cqpc.3).
// Pure SVG, zero imports. Truly verbatim — no SPA-specific adjustments.

export function BeadboxLogo({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="222 222 580 580"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="marbleBase" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#5b21b6" />
          <stop offset="1" stopColor="#5b21b6" />
        </radialGradient>
        <clipPath id="marbleClip">
          <circle cx="512" cy="512" r="250" />
        </clipPath>
      </defs>
      <circle cx="512" cy="512" r="285" fill="#242a35" />
      <g transform="translate(512, 512) scale(1.14) translate(-512, -512)">
        <circle cx="512" cy="512" r="250" fill="url(#marbleBase)" />
        <g clipPath="url(#marbleClip)">
          <path
            d="M220 432c80-130 400-180 620-100"
            fill="none"
            stroke="#ff3b3b"
            strokeWidth="110"
            opacity="0.90"
            strokeLinecap="round"
          />
          <path
            d="M200 502c110-130 420-160 660-70"
            fill="none"
            stroke="#ff6b3d"
            strokeWidth="110"
            opacity="0.95"
            strokeLinecap="round"
          />
          <path
            d="M190 572c130-130 460-155 690-50"
            fill="none"
            stroke="#ffd43b"
            strokeWidth="110"
            opacity="0.95"
            strokeLinecap="round"
          />
          <path
            d="M190 642c150-125 480-140 710-30"
            fill="none"
            stroke="#39d353"
            strokeWidth="110"
            opacity="0.95"
            strokeLinecap="round"
          />
          <path
            d="M200 712c160-120 490-130 720-10"
            fill="none"
            stroke="#1d8aff"
            strokeWidth="105"
            opacity="0.95"
            strokeLinecap="round"
          />
          <path
            d="M210 772c170-110 490-115 730 15"
            fill="none"
            stroke="#7c3aed"
            strokeWidth="90"
            opacity="0.8"
            strokeLinecap="round"
          />
        </g>
        <path
          d="M430 342c-40 25-75 70-85 110c40-15 85-45 118-90c12-17 8-35-33-20Z"
          fill="#fff"
          opacity="0.35"
        />
        <path
          d="M380 362 L408 417 L463 445 L408 473 L380 528 L352 473 L297 445 L352 417 Z"
          fill="#ffffff"
          opacity="0.95"
        />
      </g>
    </svg>
  )
}

import { cn } from "../../lib/util";

interface LogoProps {
  className?: string;
  size?: number;
}

const brandMarkViewBox = "70 86 360 338";
const brandColors = {
  wave: "#7e67c2",
  accent: "#f6cf52",
  node: "#a3abb2",
} as const;

export function LogoMark({ className, size = 22 }: LogoProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox={brandMarkViewBox}
      fill="none"
      className={cn("shrink-0", className)}
      aria-hidden
    >
      <g transform="translate(0 5)">
        <path
          d="M 132 282 C 145 285 156 296 168 315 C 185 340 198 395 226 395 C 255 395 272 315 290 255 C 302 215 312 203 322 203 C 333 203 348 235 362 278"
          stroke={brandColors.accent}
          strokeWidth="26"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M 90 280 C 115 280 130 280 142 262 C 152 240 162 220 172 220 C 182 220 193 240 200 275 C 206 298 210 310 216 310 C 222 310 234 260 242 210 C 247 180 248 163 251 163 C 254 163 255 180 260 210 C 268 260 280 345 311 345 C 324 345 334 325 344 295 C 354 268 370 280 410 280"
          stroke={brandColors.wave}
          strokeWidth="26"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="250" cy="118" r="23" fill={brandColors.node} />
      </g>
    </svg>
  );
}

export function LogoWordmark({ className }: { className?: string }): JSX.Element {
  return (
    <span
      className={cn("select-none font-serif text-[19px] leading-none tracking-tight text-ink-900", className)}
      style={{ fontFamily: "Fraunces, serif", fontStyle: "italic", fontWeight: 500 }}
    >
      senera
      <span className="ml-0.5 text-[#7e67c2]" style={{ fontStyle: "normal" }}>
        .
      </span>
    </span>
  );
}

export function LogoLockup({ className }: { className?: string }): JSX.Element {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark size={20} />
      <LogoWordmark />
    </span>
  );
}

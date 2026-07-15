import { cn } from "../../lib/util";

interface LogoProps {
  className?: string;
  size?: number;
}

export function LogoMark({ className, size = 22 }: LogoProps): JSX.Element {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center font-sans font-semibold leading-none tracking-[-0.08em] text-ink-900",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.62)) }}
      aria-hidden="true"
    >
      S
    </span>
  );
}

export function LogoWordmark({ className }: { className?: string }): JSX.Element {
  return (
    <span
      className={cn(
        "select-none font-sans text-[15px] font-semibold leading-none tracking-[-0.02em] text-ink-900",
        className,
      )}
    >
      Senera
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

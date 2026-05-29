import { cn } from "../lib/util";

interface ModelProviderIconProps {
  icon?: string;
  className?: string;
  size?: number;
}

export function ModelProviderIcon({ icon, className, size = 16 }: ModelProviderIconProps): JSX.Element | null {
  if (!icon) return null;

  const style = { height: size, width: size };
  return (
    <img
      src={readConfiguredIconSrc(icon)}
      alt=""
      aria-hidden="true"
      className={cn("shrink-0", className)}
      draggable={false}
      style={style}
    />
  );
}

function readConfiguredIconSrc(icon: string): string {
  if (icon.startsWith("/")) return icon;
  return `/icons/model-providers/${icon.endsWith(".svg") ? icon : `${icon}.svg`}`;
}

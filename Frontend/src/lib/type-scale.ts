type TypeScaleVariant = "default" | "compact";

interface TypeScalePair {
  size: number;
  leading: number;
}

interface TypeScaleStep {
  default: number;
  compact: number;
}

const typeStyles = {
  display: {
    default: { size: 28, leading: 34 },
    compact: { size: 24, leading: 30 },
  },
  title: {
    default: { size: 16, leading: 22 },
    compact: { size: 15, leading: 20 },
  },
  subtitle: {
    default: { size: 14, leading: 20 },
    compact: { size: 13, leading: 18 },
  },
  body: {
    default: { size: 13, leading: 20 },
    compact: { size: 12, leading: 18 },
  },
  caption: {
    default: { size: 12, leading: 16 },
    compact: { size: 11, leading: 14 },
  },
  micro: {
    default: { size: 11, leading: 14 },
    compact: { size: 10, leading: 12 },
  },
} as const satisfies Record<string, Record<TypeScaleVariant, TypeScalePair>>;

type TypeScaleRole = keyof typeof typeStyles;

const typeScale = Object.fromEntries(
  (Object.keys(typeStyles) as TypeScaleRole[]).map((role) => [
    role,
    { default: typeStyles[role].default.size, compact: typeStyles[role].compact.size },
  ]),
) as Record<TypeScaleRole, TypeScaleStep>;

const typeClasses = {
  default: {
    display: "text-[length:var(--fs-display,28px)] leading-[var(--lh-display,34px)]",
    title: "text-[length:var(--fs-title,16px)] leading-[var(--lh-title,22px)]",
    subtitle: "text-[length:var(--fs-subtitle,14px)] leading-[var(--lh-subtitle,20px)]",
    body: "text-[length:var(--fs-body,13px)] leading-[var(--lh-body,20px)]",
    caption: "text-[length:var(--fs-caption,12px)] leading-[var(--lh-caption,16px)]",
    micro: "text-[length:var(--fs-micro,11px)] leading-[var(--lh-micro,14px)]",
  },
  compact: {
    display: "text-[length:var(--fs-display-compact,24px)] leading-[var(--lh-display-compact,30px)]",
    title: "text-[length:var(--fs-title-compact,15px)] leading-[var(--lh-title-compact,20px)]",
    subtitle: "text-[length:var(--fs-subtitle-compact,13px)] leading-[var(--lh-subtitle-compact,18px)]",
    body: "text-[length:var(--fs-body-compact,12px)] leading-[var(--lh-body-compact,18px)]",
    caption: "text-[length:var(--fs-caption-compact,11px)] leading-[var(--lh-caption-compact,14px)]",
    micro: "text-[length:var(--fs-micro-compact,10px)] leading-[var(--lh-micro-compact,12px)]",
  },
} as const satisfies Record<TypeScaleVariant, Record<TypeScaleRole, string>>;

function typeClass(role: TypeScaleRole, variant: TypeScaleVariant = "default"): string {
  return typeClasses[variant][role];
}

export { typeStyles, typeScale, typeClasses, typeClass };
export type { TypeScaleRole, TypeScaleVariant, TypeScalePair, TypeScaleStep };

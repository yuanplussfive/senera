import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import {
  typeClasses,
  typeClass,
  typeScale,
  typeStyles,
  type TypeScaleRole,
  type TypeScalePair,
  type TypeScaleStep,
} from "./type-scale";

export type SizeVariant = "default" | "compact";

interface SizeClasses {
  variant: SizeVariant;
  type: Record<TypeScaleRole, string>;
  gap: string;
  icon: number;
}

const sizeMap: Record<SizeVariant, SizeClasses> = {
  default: { variant: "default", type: typeClasses.default, gap: "gap-2", icon: 20 },
  compact: { variant: "compact", type: typeClasses.compact, gap: "gap-1", icon: 18 },
};

interface SizeContextValue {
  size: SizeVariant;
  setSize: (size: SizeVariant) => void;
  classes: SizeClasses;
}

const SizeContext = createContext<SizeContextValue | null>(null);

function useSizeVariant(override?: SizeVariant | null): SizeVariant {
  return override ?? useContext(SizeContext)?.size ?? "default";
}

function useSize(override?: SizeVariant | null): SizeClasses {
  return sizeMap[useSizeVariant(override)];
}

export function SizeProvider({
  children,
  size,
  defaultSize = "default",
}: {
  children: ReactNode;
  size?: SizeVariant;
  defaultSize?: SizeVariant;
}): JSX.Element {
  const [internalSize, setInternalSize] = useState<SizeVariant>(defaultSize);
  const resolved = size ?? internalSize;
  const value = useMemo<SizeContextValue>(
    () => ({ size: resolved, setSize: setInternalSize, classes: sizeMap[resolved] }),
    [resolved],
  );
  return <SizeContext.Provider value={value}>{children}</SizeContext.Provider>;
}

export { useSize, useSizeVariant, sizeMap, typeStyles, typeScale, typeClasses, typeClass };
export type { SizeClasses, TypeScaleRole, TypeScalePair, TypeScaleStep };

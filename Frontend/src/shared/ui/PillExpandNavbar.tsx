import * as TabsPrimitive from "@radix-ui/react-tabs";
import { motion } from "framer-motion";
import { useState, type ReactNode } from "react";
import { cn } from "../../lib/util";
import { useMotionLevel } from "../motion";
import { Button } from "./Button";

/**
 * Adapted from Rewamp UI's Pill Expand Navbar by palakonweb.
 * https://rewampui.com/components/pill-expand-navbar
 * Source and reuse review: docs/Development/RewampComponentIntegration.md.
 */
export interface PillExpandNavbarItem {
  readonly id: string;
  readonly label: string;
  readonly icon: ReactNode;
  readonly disabled?: boolean;
  readonly attributes?: Readonly<Record<`data-${string}`, string>>;
}

export interface PillExpandNavbarProps {
  readonly items: readonly PillExpandNavbarItem[];
  readonly value?: string;
  readonly onValueChange?: (value: string) => void;
  /** Tabs mode belongs inside the existing Tabs root; Radix owns selection and keys. */
  readonly mode?: "navigation" | "tabs";
  readonly label: string;
  readonly className?: string;
  readonly attributes?: Readonly<Record<`data-${string}`, string>>;
}

const MotionButton = motion.create(Button);
const expansionSpring = { type: "spring", stiffness: 220, damping: 24 } as const;

export function PillExpandNavbar({
  items,
  value,
  onValueChange,
  mode = "navigation",
  label,
  className,
  attributes,
}: PillExpandNavbarProps): JSX.Element {
  const [hovered, setHovered] = useState<string>();
  const [focused, setFocused] = useState<string>();
  const { reduceMotion } = useMotionLevel();
  const expandedId = hovered ?? focused ?? value;
  const transition = reduceMotion ? { duration: 0 } : expansionSpring;
  const children = items.map((item) => {
    const active = item.id === value;
    const expanded = item.id === expandedId && !item.disabled;
    const button = (
      <MotionButton
        variant="ghost"
        className={cn(
          "pill-expand-nav-item",
          active && "pill-expand-nav-item--active",
          expanded && "pill-expand-nav-item--expanded",
        )}
        disabled={item.disabled}
        aria-label={item.label}
        aria-pressed={mode === "navigation" ? active : undefined}
        title={item.label}
        onClick={mode === "navigation" ? () => onValueChange?.(item.id) : undefined}
        onPointerEnter={(event) => {
          if (event.pointerType !== "touch" && !item.disabled) setHovered(item.id);
        }}
        onFocus={() => setFocused(item.id)}
        onBlur={() => setFocused(undefined)}
        whileTap={reduceMotion ? undefined : { scale: 0.96 }}
        data-pill-expanded={expanded}
        {...item.attributes}
      >
        <span className="pill-expand-nav-icon" aria-hidden="true">
          {item.icon}
        </span>
        <motion.span
          initial={false}
          animate={{
            width: expanded ? "auto" : 0,
            opacity: expanded ? 1 : 0,
            x: expanded ? 0 : -4,
            marginLeft: expanded ? 8 : 0,
          }}
          transition={{
            width: transition,
            marginLeft: transition,
            opacity: { duration: reduceMotion ? 0 : 0.18 },
            x: { duration: reduceMotion ? 0 : 0.18 },
          }}
          className="pill-expand-nav-label"
          aria-hidden="true"
        >
          {item.label}
        </motion.span>
      </MotionButton>
    );
    return mode === "tabs" ? (
      <TabsPrimitive.Trigger key={item.id} value={item.id} asChild disabled={item.disabled}>
        {button}
      </TabsPrimitive.Trigger>
    ) : (
      <span key={item.id} className="contents">
        {button}
      </span>
    );
  });
  const props = {
    className: cn("pill-expand-nav", className),
    "aria-label": label,
    onPointerLeave: () => setHovered(undefined),
    "data-pill-expand-navbar": "",
    ...attributes,
  };
  return mode === "tabs" ? (
    <TabsPrimitive.List {...props}>{children}</TabsPrimitive.List>
  ) : (
    <nav {...props}>{children}</nav>
  );
}

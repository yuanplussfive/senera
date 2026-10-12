"use client";

import * as Collapsible from "@radix-ui/react-collapsible";
import { motion } from "framer-motion";
import {
  createContext,
  forwardRef,
  useContext,
  useId,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { cn } from "../../lib/util";
import { MotionDisclosure } from "../motion/MotionDisclosure";
import { AppIcon, type AppIconName } from "./AppIcon";

type ThinkingStepStatus = "complete" | "active" | "pending";

interface ThinkingStepsContextValue {
  open: boolean;
  contentId: string;
  rail: ThinkingStepsRail;
}

const ThinkingStepsContext = createContext<ThinkingStepsContextValue | null>(null);

function useThinkingStepsContext(componentName: string): ThinkingStepsContextValue {
  const context = useContext(ThinkingStepsContext);
  if (!context) {
    throw new Error(`${componentName} must be used inside ThinkingSteps.`);
  }
  return context;
}

export interface ThinkingStepsProps extends HTMLAttributes<HTMLDivElement> {
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  rail?: ThinkingStepsRail;
  children: ReactNode;
}

export type ThinkingStepsRail = "straight" | "organic";

/**
 * Official source shape: https://www.fluidfunctionalism.com/r/thinking-steps.json
 *
 * This is the project's registry adapter: the Radix/framer interaction and
 * step geometry stay aligned with the source, while icons and theme tokens
 * resolve through Senera's existing shared UI primitives.
 */
export const ThinkingSteps = forwardRef<HTMLDivElement, ThinkingStepsProps>(function ThinkingSteps(
  { defaultOpen = true, open, onOpenChange, rail = "straight", children, className, ...props },
  ref,
) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isControlled = open !== undefined;
  const isOpen = open ?? internalOpen;
  const contentId = useId();

  return (
    <Collapsible.Root
      open={isOpen}
      onOpenChange={(nextOpen) => {
        if (!isControlled) setInternalOpen(nextOpen);
        onOpenChange?.(nextOpen);
      }}
      asChild
    >
      <div
        ref={ref}
        className={cn("min-w-0", className)}
        data-thinking-steps
        data-thinking-steps-rail={rail}
        {...props}
      >
        <ThinkingStepsContext.Provider value={{ open: isOpen, contentId, rail }}>
          {children}
        </ThinkingStepsContext.Provider>
      </div>
    </Collapsible.Root>
  );
});

ThinkingSteps.displayName = "ThinkingSteps";

export interface ThinkingStepsHeaderProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children?: ReactNode;
  showChevron?: boolean;
}

export const ThinkingStepsHeader = forwardRef<HTMLButtonElement, ThinkingStepsHeaderProps>(function ThinkingStepsHeader(
  { children = "Thinking", showChevron = true, className, ...props },
  ref,
) {
  const { open, contentId } = useThinkingStepsContext("ThinkingStepsHeader");

  return (
    <Collapsible.Trigger asChild>
      <button
        ref={ref}
        type="button"
        aria-controls={contentId}
        className={cn(
          "relative flex min-w-0 w-full items-center gap-2 text-left outline-none transition-colors",
          "focus-visible:ring-2 focus-visible:ring-accent-focus",
          className,
        )}
        {...props}
      >
        {children}
        {showChevron ? (
          <motion.span
            className="ml-auto inline-flex shrink-0 items-center justify-center text-content-muted"
            animate={{ rotate: open ? 90 : 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            aria-hidden="true"
          >
            <AppIcon icon="chevron-right" size={14} />
          </motion.span>
        ) : null}
      </button>
    </Collapsible.Trigger>
  );
});

ThinkingStepsHeader.displayName = "ThinkingStepsHeader";

export interface ThinkingStepsContentProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  unmountOnClose?: boolean;
}

export function ThinkingStepsContent({
  children,
  className,
  unmountOnClose = false,
  ...props
}: ThinkingStepsContentProps): JSX.Element | null {
  const { open, contentId } = useThinkingStepsContext("ThinkingStepsContent");

  if (unmountOnClose && !open) return null;

  return (
    <MotionDisclosure id={contentId} open={open} className={cn("min-w-0", className)}>
      <div data-thinking-steps-content {...props}>
        {children}
      </div>
    </MotionDisclosure>
  );
}

export interface ThinkingStepProps extends HTMLAttributes<HTMLDivElement> {
  icon?: AppIconName;
  showIcon?: boolean;
  label?: ReactNode;
  description?: ReactNode;
  status?: ThinkingStepStatus;
  isLast?: boolean;
  connector?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
  delay?: number;
  children?: ReactNode;
}

export function ThinkingStep({
  icon,
  showIcon = true,
  label,
  description,
  status = "complete",
  isLast = false,
  connector = true,
  leading,
  trailing,
  delay = 0,
  children,
  className,
  ...props
}: ThinkingStepProps): JSX.Element | null {
  if (status === "pending") return null;

  const { rail } = useThinkingStepsContext("ThinkingStep");
  const active = status === "active";
  const iconNode =
    leading ??
    (showIcon && icon ? (
      <AppIcon icon={icon} size={14} strokeWidth={1.6} className="text-content-muted" />
    ) : (
      <span className="h-1 w-1 rounded-full bg-content-muted/80" aria-hidden="true" />
    ));

  return (
    <div className={cn("relative min-w-0", className)} data-thinking-step data-thinking-step-status={status} {...props}>
      <motion.div
        initial={{ opacity: 0, y: 2 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18, delay, ease: "easeOut" }}
      >
        <div className="flex min-w-0 items-start gap-2.5 px-2 py-1.5" data-thinking-step-row>
          <div className="relative flex w-4 shrink-0 self-stretch items-start justify-center" data-thinking-step-marker>
            <div className="relative z-[1] flex h-5 items-center justify-center" data-thinking-step-node>
              {iconNode}
            </div>
            {!isLast && connector ? (
              <div
                className="thinking-step-connector absolute left-1/2 top-2.5 -bottom-4 w-px bg-line-subtle"
                data-thinking-step-connector
                data-thinking-step-rail={rail}
                aria-hidden="true"
              />
            ) : null}
          </div>
          <div className="min-w-0 flex-1" data-thinking-step-content>
            {label !== undefined ? (
              <div
                className={cn(
                  "min-w-0 break-words text-[13px] leading-5 text-content-primary",
                  active && "shimmer-text",
                )}
                data-thinking-step-label
              >
                {label}
                {active ? <span aria-hidden="true">…</span> : null}
              </div>
            ) : null}
            {description !== undefined ? (
              <div className="mt-0.5 min-w-0 break-words text-[12px] leading-5 text-content-secondary">
                {description}
              </div>
            ) : null}
            {children}
          </div>
          {trailing ? <span className="shrink-0 text-[11px] tabular-nums text-content-muted">{trailing}</span> : null}
        </div>
      </motion.div>
    </div>
  );
}

ThinkingStep.displayName = "ThinkingStep";

export interface ThinkingStepDetailsProps {
  summary: ReactNode;
  details?: readonly ReactNode[];
  defaultOpen?: boolean;
  children?: ReactNode;
  className?: string;
}

export function ThinkingStepDetails({
  summary,
  details,
  defaultOpen = false,
  children,
  className,
}: ThinkingStepDetailsProps): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();

  return (
    <div className={cn("mt-1 min-w-0", className)} data-thinking-step-details>
      <Collapsible.Root open={open} onOpenChange={setOpen} asChild>
        <div>
          <Collapsible.Trigger asChild>
            <button
              type="button"
              className="inline-flex min-w-0 items-center gap-1.5 py-1 text-left text-[11.5px] leading-5 text-content-muted transition-colors hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus"
              aria-controls={contentId}
              data-thinking-step-details-trigger
            >
              <motion.span
                animate={{ rotate: open ? 90 : 0 }}
                transition={{ duration: 0.16, ease: "easeOut" }}
                aria-hidden="true"
              >
                <AppIcon icon="chevron-right" size={12} />
              </motion.span>
              <span className="truncate">{summary}</span>
            </button>
          </Collapsible.Trigger>
          <MotionDisclosure id={contentId} open={open} className="min-w-0">
            <div className="flex min-w-0 flex-col gap-0.5 pb-1 pl-4 text-[11.5px] leading-5 text-content-muted">
              {details?.map((detail, index) => (
                <div key={index}>{detail}</div>
              ))}
              {children}
            </div>
          </MotionDisclosure>
        </div>
      </Collapsible.Root>
    </div>
  );
}

export interface ThinkingStepSourcesProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export const ThinkingStepSources = forwardRef<HTMLDivElement, ThinkingStepSourcesProps>(function ThinkingStepSources(
  { children, className, ...props },
  ref,
) {
  return (
    <div ref={ref} className={cn("mt-1 flex min-w-0 flex-wrap gap-1.5", className)} {...props}>
      {children}
    </div>
  );
});

ThinkingStepSources.displayName = "ThinkingStepSources";

export interface ThinkingStepSourceProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
  delay?: number;
}

export function ThinkingStepSource({ children, delay = 0, className, ...props }: ThinkingStepSourceProps): JSX.Element {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center truncate rounded-sm border border-line-subtle bg-surface-muted px-1.5 py-0.5 text-[11px] leading-4 text-content-secondary",
        className,
      )}
      {...props}
    >
      <motion.span
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.16, delay, ease: "easeOut" }}
      >
        {children}
      </motion.span>
    </span>
  );
}

ThinkingStepSource.displayName = "ThinkingStepSource";

export type { ThinkingStepStatus };

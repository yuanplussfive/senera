"use client";

import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "framer-motion";
import { forwardRef, useEffect, useState, type HTMLAttributes } from "react";
import { cn } from "../../lib/util";
import { fontWeights } from "../../lib/font-weight";
import { useSize, type SizeVariant, typeClass } from "../../lib/size-context";

const circleA =
  "M 12 8 C 14.21 8 16 9.79 16 12 C 16 14.21 14.21 16 12 16 C 9.79 16 8 14.21 8 12 C 8 9.79 9.79 8 12 8 Z";
const infinity = "M 12 12 C 14 8.5 19 8.5 19 12 C 19 15.5 14 15.5 12 12 C 10 8.5 5 8.5 5 12 C 5 15.5 10 15.5 12 12 Z";
const circleB =
  "M 12 16 C 14.21 16 16 14.21 16 12 C 16 9.79 14.21 8 12 8 C 9.79 8 8 9.79 8 12 C 8 14.21 9.79 16 12 16 Z";
const words = ["Thinking", "Moonwalking", "Planning", "Refining"] as const;

export interface ThinkingIndicatorProps extends HTMLAttributes<HTMLDivElement> {
  showIcon?: boolean;
  /** Internal compact-row integration; the official default keeps the label. */
  showLabel?: boolean;
  size?: SizeVariant;
}

export type ThinkingIndicatorSize = SizeVariant;

/**
 * Fluid Functionalism registry component, adapted only for Senera's aliases
 * and motion/theme providers. The registry paths, cadence and shimmer are
 * preserved; the path starts at the visible infinity phase so a compact live
 * row never opens on an almost invisible circle.
 */
export const ThinkingIndicator = forwardRef<HTMLDivElement, ThinkingIndicatorProps>(function ThinkingIndicator(
  { className, showIcon = true, showLabel = true, size, ...props },
  ref,
) {
  const compactStep = useSize(size).variant === "compact";
  const [index, setIndex] = useState(0);
  // Keep the registry component's motion contract: only the device-level
  // reduced-motion preference changes the morphing path and word cadence.
  const reduceMotion = useReducedMotion() ?? false;

  useEffect(() => {
    if (reduceMotion || !showLabel) return;
    const interval = window.setInterval(() => {
      setIndex((current) => (current + 1) % words.length);
    }, 4000);
    return () => window.clearInterval(interval);
  }, [reduceMotion, showLabel]);

  return (
    <MotionConfig reducedMotion={reduceMotion ? "always" : "never"}>
      <div
        ref={ref}
        role="status"
        className={cn("thinking-indicator flex items-center gap-2 px-3 py-2", className)}
        data-thinking-indicator
        data-thinking-indicator-size={compactStep ? "compact" : "default"}
        {...props}
      >
        <span className="sr-only">Thinking...</span>
        {showIcon ? (
          <motion.svg
            aria-hidden="true"
            width={compactStep ? 18 : 20}
            height={compactStep ? 18 : 20}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-content-secondary shrink-0"
          >
            {reduceMotion ? (
              <path d={infinity} />
            ) : (
              <motion.path
                d={infinity}
                initial={{ d: infinity }}
                animate={{ d: [infinity, circleA, infinity, circleB, infinity] }}
                transition={{
                  d: {
                    duration: 6,
                    ease: "easeInOut",
                    repeat: Infinity,
                    times: [0, 0.25, 0.5, 0.75, 1],
                  },
                }}
              />
            )}
          </motion.svg>
        ) : null}
        {showLabel ? (
          <span
            aria-hidden="true"
            className={cn("inline-grid overflow-hidden", typeClass("body", compactStep ? "compact" : "default"))}
            style={{ fontVariationSettings: fontWeights.normal }}
          >
            <span className="col-start-1 row-start-1 invisible shimmer-text">Moonwalking</span>
            {reduceMotion ? (
              <span className="col-start-1 row-start-1 shimmer-text">{words[0]}</span>
            ) : (
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={words[index]}
                  className="col-start-1 row-start-1 shimmer-text"
                  initial={{ y: "80%", opacity: 0 }}
                  animate={{ y: 0, opacity: 1, transition: { duration: 0.24, ease: [0.4, 0, 0.2, 1] } }}
                  exit={{ y: "-80%", opacity: 0, transition: { duration: 0.16, ease: [0.4, 0, 0.2, 1] } }}
                >
                  {words[index]}
                </motion.span>
              </AnimatePresence>
            )}
          </span>
        ) : null}
      </div>
    </MotionConfig>
  );
});

ThinkingIndicator.displayName = "ThinkingIndicator";

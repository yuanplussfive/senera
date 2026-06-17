import type { TargetAndTransition, Transition, Variants } from "framer-motion";
import type { MotionLevel } from "./types";

const easeOut = [0.22, 1, 0.36, 1] as const;
export type DialogMotionPreset = "modal" | "focus";
export type DialogPanelVariants = Record<"hidden" | "show" | "exit", TargetAndTransition>;
export type DrawerPanelVariants = Record<"hidden" | "show" | "exit", TargetAndTransition>;
export type OverlayVariants = Record<"hidden" | "show" | "exit", TargetAndTransition>;
export const dialogPresenceExitMs = 320;

export const motionSprings = {
  snappy: { type: "spring", stiffness: 520, damping: 42 } satisfies Transition,
  soft: { type: "spring", stiffness: 360, damping: 34 } satisfies Transition,
  drawer: { type: "spring", stiffness: 420, damping: 40, mass: 1 } satisfies Transition,
};

export const motionTimings = {
  fast: { duration: 0.12, ease: easeOut } satisfies Transition,
  base: { duration: 0.18, ease: easeOut } satisfies Transition,
  dialog: { duration: 0.22, ease: easeOut } satisfies Transition,
  modalOpen: { duration: 0.25, ease: easeOut } satisfies Transition,
  modalClose: { duration: 0.15, ease: easeOut } satisfies Transition,
  slow: { duration: 0.28, ease: easeOut } satisfies Transition,
};

export const motionRules = {
  maxStaggerItems: 20,
  defaultStagger: 0.02,
  maxStagger: 0.03,
};

export function readStagger(count: number, requested = motionRules.defaultStagger): number {
  if (count > motionRules.maxStaggerItems) return 0;
  return Math.min(requested, motionRules.maxStagger);
}

export function readListItemVariants(level: MotionLevel): Variants {
  if (level === "none") {
    return {
      hidden: { opacity: 1 },
      show: { opacity: 1 },
      exit: { opacity: 1 },
    };
  }
  if (level === "reduced") {
    return {
      hidden: { opacity: 0 },
      show: { opacity: 1 },
      exit: { opacity: 0 },
    };
  }
  return {
    hidden: { opacity: 0, y: 6 },
    show: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -4 },
  };
}

export function readListTransition(level: MotionLevel, delay = 0): Transition {
  if (level === "none") return { duration: 0 };
  return {
    ...motionTimings.base,
    delay,
    layout: motionSprings.snappy,
  };
}

export function readTapScale(level: MotionLevel): number | undefined {
  return level === "full" ? 0.985 : undefined;
}

export function readMessageItemVariants(level: MotionLevel): Variants {
  if (level === "none") {
    return {
      hidden: { opacity: 1 },
      show: { opacity: 1 },
      exit: { opacity: 1 },
    };
  }
  if (level === "reduced") {
    return {
      hidden: { opacity: 0 },
      show: { opacity: 1 },
      exit: { opacity: 0 },
    };
  }
  return {
    hidden: { opacity: 0, y: 8 },
    show: { opacity: 1, y: 0 },
    exit: { opacity: 0 },
  };
}

export function readFeedItemVariants(level: MotionLevel): Variants {
  if (level === "none") {
    return {
      hidden: { opacity: 1 },
      show: { opacity: 1 },
      exit: { opacity: 1 },
    };
  }
  if (level === "reduced") {
    return {
      hidden: { opacity: 0 },
      show: { opacity: 1 },
      exit: { opacity: 0 },
    };
  }
  return {
    hidden: { opacity: 0, y: 4 },
    show: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -2 },
  };
}

export function readOverlayVariants(level: MotionLevel): OverlayVariants {
  if (level === "none") {
    return {
      hidden: { opacity: 0 },
      show: { opacity: 1 },
      exit: { opacity: 0 },
    };
  }
  return {
    hidden: { opacity: 0 },
    show: { opacity: 1 },
    exit: { opacity: 0 },
  };
}

export function readDialogPanelVariants(level: MotionLevel, preset: DialogMotionPreset = "modal"): DialogPanelVariants {
  if (level === "none") {
    return {
      hidden: { opacity: 0 },
      show: { opacity: 1 },
      exit: { opacity: 0 },
    };
  }
  if (level === "reduced") {
    return {
      hidden: { opacity: 0 },
      show: { opacity: 1 },
      exit: { opacity: 0 },
    };
  }
  if (preset === "focus") {
    return {
      hidden: { opacity: 0, y: 10, scale: 0.985 },
      show: { opacity: 1, y: 0, scale: 1 },
      exit: { opacity: 0, y: 8, scale: 0.99 },
    };
  }
  return {
    hidden: { opacity: 0, scale: 0.96 },
    show: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.96 },
  };
}

export function readOverlayTransition(level: MotionLevel, state: "show" | "exit" = "show"): Transition {
  if (level === "none") return { duration: 0 };
  return state === "exit" ? motionTimings.modalClose : motionTimings.modalOpen;
}

export function readDialogPanelTransition(
  level: MotionLevel,
  preset: DialogMotionPreset = "modal",
  state: "show" | "exit" = "show",
): Transition {
  if (level === "none") return { duration: 0 };
  if (level === "reduced") return motionTimings.base;
  if (preset === "modal") return state === "exit" ? motionTimings.modalClose : motionTimings.modalOpen;
  return preset === "focus" ? motionTimings.slow : motionTimings.dialog;
}

export function readDrawerVariants(level: MotionLevel, side: "left" | "right" = "right"): DrawerPanelVariants {
  const hiddenX = side === "right" ? "100%" : "-100%";
  if (level === "none") {
    return {
      hidden: { opacity: 1, x: hiddenX },
      show: { opacity: 1, x: 0 },
      exit: { opacity: 1, x: hiddenX },
    };
  }
  if (level === "reduced") {
    return {
      hidden: { opacity: 0 },
      show: { opacity: 1 },
      exit: { opacity: 0 },
    };
  }
  return {
    hidden: { opacity: 1, x: hiddenX },
    show: { opacity: 1, x: 0 },
    exit: { opacity: 1, x: hiddenX },
  };
}

export function readFocusPanelVariants(level: MotionLevel): Variants {
  if (level === "none") {
    return {
      hidden: { opacity: 1 },
      show: { opacity: 1 },
      exit: { opacity: 1 },
    };
  }
  if (level === "reduced") {
    return {
      hidden: { opacity: 0 },
      show: { opacity: 1 },
      exit: { opacity: 0 },
    };
  }
  return {
    hidden: { opacity: 0 },
    show: { opacity: 1 },
    exit: { opacity: 0 },
  };
}

import { Profiler, type ProfilerOnRenderCallback, type ReactNode } from "react";

interface PerformanceMonitorProps {
  id: string;
  children: ReactNode;
  enabled?: boolean;
  onSlowRender?: (id: string, duration: number) => void;
  slowThresholdMs?: number;
}

export function PerformanceMonitor({
  id,
  children,
  enabled = import.meta.env.DEV,
  onSlowRender,
  slowThresholdMs = 16, // ~60fps threshold
}: PerformanceMonitorProps): JSX.Element {
  const handleRender: ProfilerOnRenderCallback = (
    id,
    phase,
    actualDuration,
    baseDuration,
    startTime,
    commitTime,
  ) => {
    // Only log in development
    if (import.meta.env.DEV) {
      // Log slow renders
      if (actualDuration > slowThresholdMs) {
        console.warn(
          `[PerformanceMonitor] Slow render detected in "${id}"`,
          `\n  Phase: ${phase}`,
          `\n  Actual: ${actualDuration.toFixed(2)}ms`,
          `\n  Base: ${baseDuration.toFixed(2)}ms`,
          `\n  Start: ${startTime.toFixed(2)}ms`,
          `\n  Commit: ${commitTime.toFixed(2)}ms`,
        );

        // Call optional callback
        onSlowRender?.(id, actualDuration);
      }

      // Optional: Track all renders for analysis
      // Uncomment to see every render
      // console.log(`[PerformanceMonitor] "${id}" rendered in ${actualDuration.toFixed(2)}ms (${phase})`);
    }
  };

  if (!enabled) {
    return <>{children}</>;
  }

  return (
    <Profiler id={id} onRender={handleRender}>
      {children}
    </Profiler>
  );
}

// Utility for logging performance marks
export function markPerformance(name: string): void {
  if (import.meta.env.DEV && typeof performance !== "undefined") {
    performance.mark(name);
  }
}

export function measurePerformance(name: string, startMark: string, endMark?: string): void {
  if (import.meta.env.DEV && typeof performance !== "undefined") {
    try {
      if (endMark) {
        performance.measure(name, startMark, endMark);
      } else {
        performance.measure(name, startMark);
      }
      const measure = performance.getEntriesByName(name, "measure")[0];
      console.log(`[Performance] ${name}: ${measure.duration.toFixed(2)}ms`);
    } catch (error) {
      console.warn(`[Performance] Failed to measure "${name}":`, error);
    }
  }
}

import { useCallback, useEffect, useRef } from "react";

/**
 * 测量消息项的实际高度并缓存
 */
export function useMessageHeightObserver(
  enabled: boolean,
  onHeightMeasured: (key: string, height: number) => void,
): (element: HTMLElement | null) => void {
  const observerRef = useRef<ResizeObserver | null>(null);
  const observedElementsRef = useRef<Map<HTMLElement, string>>(new Map());
  const onHeightMeasuredRef = useRef(onHeightMeasured);

  useEffect(() => {
    onHeightMeasuredRef.current = onHeightMeasured;
  }, [onHeightMeasured]);

  const ensureObserver = useCallback((): ResizeObserver | null => {
    if (!enabled) return null;
    if (observerRef.current) return observerRef.current;

    observerRef.current = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const element = entry.target as HTMLElement;
        const key = observedElementsRef.current.get(element);
        if (!element.isConnected) {
          observerRef.current?.unobserve(element);
          observedElementsRef.current.delete(element);
          continue;
        }
        if (key) {
          const height = entry.borderBoxSize?.[0]?.blockSize ?? element.offsetHeight;
          if (height > 0) {
            onHeightMeasuredRef.current(key, height);
          }
        }
      }
    });

    return observerRef.current;
  }, [enabled]);

  const pruneDisconnectedElements = useCallback((): void => {
    const observer = observerRef.current;
    for (const element of observedElementsRef.current.keys()) {
      if (element.isConnected) continue;
      observer?.unobserve(element);
      observedElementsRef.current.delete(element);
    }
  }, []);

  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      observedElementsRef.current.clear();
    };
  }, [enabled]);

  return useCallback((element: HTMLElement | null) => {
    pruneDisconnectedElements();
    if (!element) return;

    const key = element.getAttribute("data-message-key");
    if (!key) return;

    observedElementsRef.current.set(element, key);
    ensureObserver()?.observe(element);
  }, [ensureObserver, pruneDisconnectedElements]);
}

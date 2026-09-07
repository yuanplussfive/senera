import type { PanzoomEventDetail, PanzoomObject } from "@panzoom/panzoom";
import { Maximize2, Scan, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type SyntheticEvent } from "react";
import { cn } from "../../lib/util";
import { useMotionLevel } from "../motion";
import { IconButton } from "../ui";

export interface ImageCanvasViewerLabels {
  readonly actualSize: string;
  readonly fit: string;
  readonly zoomIn: string;
  readonly zoomOut: string;
}

export interface ImageCanvasViewerProps {
  readonly alt: string;
  readonly className?: string;
  readonly imageClassName?: string;
  readonly labels: ImageCanvasViewerLabels;
  readonly onError?: () => void;
  readonly onLoad?: () => void;
  readonly source: string;
}

type NaturalImageSize = {
  readonly height: number;
  readonly source: string;
  readonly width: number;
};

type ImageViewMode = "actual" | "custom" | "fit";

const ImageCanvasScale = {
  max: 8,
  min: 0.1,
  step: 0.25,
} as const;

const ImageCanvasInset = 48;

export function ImageCanvasViewer({
  alt,
  className,
  imageClassName,
  labels,
  onError,
  onLoad,
  source,
}: ImageCanvasViewerProps): JSX.Element {
  const { reduceMotion } = useMotionLevel();
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const panzoomRef = useRef<PanzoomObject | undefined>(undefined);
  const fitScaleRef = useRef(1);
  const modeRef = useRef<ImageViewMode>("fit");
  const [naturalSize, setNaturalSize] = useState<NaturalImageSize>();
  const [ready, setReady] = useState(false);
  const [scale, setScale] = useState(1);
  const [viewMode, setViewMode] = useState<ImageViewMode>("fit");

  const commitMode = useCallback((mode: ImageViewMode): void => {
    modeRef.current = mode;
    setViewMode(mode);
  }, []);

  const fitImage = useCallback((): void => {
    commitMode("fit");
    const instance = panzoomRef.current;
    if (!instance) return;
    applyScaleAndCenter(instance, fitScaleRef.current, !reduceMotion);
  }, [commitMode, reduceMotion]);

  const showActualSize = useCallback((): void => {
    commitMode("actual");
    const instance = panzoomRef.current;
    if (!instance) return;
    applyScaleAndCenter(instance, 1, !reduceMotion);
  }, [commitMode, reduceMotion]);

  const zoomIn = useCallback((): void => {
    commitMode("custom");
    panzoomRef.current?.zoomIn({ animate: !reduceMotion });
  }, [commitMode, reduceMotion]);

  const zoomOut = useCallback((): void => {
    commitMode("custom");
    panzoomRef.current?.zoomOut({ animate: !reduceMotion });
  }, [commitMode, reduceMotion]);

  useEffect(() => {
    setNaturalSize(undefined);
    setReady(false);
    setScale(1);
    commitMode("fit");
  }, [commitMode, source]);

  useEffect(() => {
    const stage = stageRef.current;
    const image = imageRef.current;
    if (!stage || !image || !naturalSize || naturalSize.source !== source) return;

    let cancelled = false;
    let instance: PanzoomObject | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let handleChange: ((event: Event) => void) | undefined;
    let handleWheel: ((event: WheelEvent) => void) | undefined;

    void import("@panzoom/panzoom/dist/panzoom.es.js").then(({ default: createPanzoom }) => {
      if (cancelled) return;

      const initialFitScale = readFitScale(stage, naturalSize);
      fitScaleRef.current = initialFitScale;
      instance = createPanzoom(image, {
        animate: !reduceMotion,
        canvas: true,
        cursor: "grab",
        duration: 160,
        maxScale: ImageCanvasScale.max,
        minScale: Math.min(ImageCanvasScale.min, initialFitScale),
        overflow: "hidden",
        panOnlyWhenZoomed: true,
        pinchAndPan: true,
        startScale: initialFitScale,
        step: ImageCanvasScale.step,
      });
      panzoomRef.current = instance;
      setScale(initialFitScale);
      setReady(true);

      handleChange = (event: Event): void => {
        const detail = (event as CustomEvent<PanzoomEventDetail>).detail;
        if (detail) setScale(detail.scale);
      };
      handleWheel = (event: WheelEvent): void => {
        commitMode("custom");
        instance?.zoomWithWheel(event);
      };
      image.addEventListener("panzoomchange", handleChange);
      stage.addEventListener("wheel", handleWheel, { passive: false });

      resizeObserver = new ResizeObserver(() => {
        if (!instance) return;
        const nextFitScale = readFitScale(stage, naturalSize);
        fitScaleRef.current = nextFitScale;
        instance.setOptions({
          minScale: Math.min(ImageCanvasScale.min, nextFitScale),
          startScale: nextFitScale,
        });
        if (modeRef.current === "fit") {
          applyScaleAndCenter(instance, nextFitScale, false);
        }
      });
      resizeObserver.observe(stage);
    });

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      if (handleChange) image.removeEventListener("panzoomchange", handleChange);
      if (handleWheel) stage.removeEventListener("wheel", handleWheel);
      if (panzoomRef.current === instance) panzoomRef.current = undefined;
      instance?.destroy();
      instance?.resetStyle();
    };
  }, [commitMode, naturalSize, reduceMotion, source]);

  const handleImageLoad = (event: SyntheticEvent<HTMLImageElement>): void => {
    const image = event.currentTarget;
    setNaturalSize({ height: image.naturalHeight, source, width: image.naturalWidth });
    onLoad?.();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomIn();
      return;
    }
    if (event.key === "-") {
      event.preventDefault();
      zoomOut();
      return;
    }
    if (event.key === "0") {
      event.preventDefault();
      fitImage();
      return;
    }
    if (event.key === "1") {
      event.preventDefault();
      showActualSize();
    }
  };

  return (
    <div
      className={cn("relative h-full min-h-0 overflow-hidden bg-surface-muted", className)}
      data-image-canvas-viewer
      data-image-scale={scale.toFixed(3)}
      data-image-view-mode={viewMode}
    >
      <div
        ref={stageRef}
        className="relative h-full min-h-0 w-full touch-none select-none overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-focus"
        aria-label={alt}
        role="region"
        tabIndex={0}
        onDoubleClick={() => {
          if (viewMode === "fit") showActualSize();
          else fitImage();
        }}
        onKeyDown={handleKeyDown}
        onPointerDown={(event) => event.currentTarget.focus({ preventScroll: true })}
        data-image-canvas-stage
      >
        <img
          key={source}
          ref={imageRef}
          src={source}
          alt={alt}
          className={cn(
            "absolute left-1/2 top-1/2 block max-h-none max-w-none shrink-0 object-contain transition-opacity duration-150",
            ready ? "opacity-100" : "opacity-0",
            imageClassName,
          )}
          style={
            naturalSize
              ? {
                  height: naturalSize.height,
                  marginLeft: -naturalSize.width / 2,
                  marginTop: -naturalSize.height / 2,
                  width: naturalSize.width,
                }
              : undefined
          }
          draggable={false}
          onLoad={handleImageLoad}
          onError={onError}
          data-image-canvas-image
        />
      </div>

      <div className="absolute right-3 top-3 z-10 flex items-center gap-0.5 rounded-md border border-line bg-surface-panel/90 p-0.5 shadow-soft backdrop-blur-sm">
        <ImageControl
          label={labels.zoomOut}
          disabled={scale <= Math.min(ImageCanvasScale.min, fitScaleRef.current)}
          onClick={zoomOut}
        >
          <ZoomOut className="h-4 w-4" />
        </ImageControl>
        <ImageControl label={labels.fit} onClick={fitImage}>
          <Maximize2 className="h-4 w-4" />
        </ImageControl>
        <ImageControl label={labels.zoomIn} disabled={scale >= ImageCanvasScale.max} onClick={zoomIn}>
          <ZoomIn className="h-4 w-4" />
        </ImageControl>
        <ImageControl label={labels.actualSize} onClick={showActualSize}>
          <Scan className="h-4 w-4" />
        </ImageControl>
      </div>
    </div>
  );
}

function ImageControl({
  children,
  disabled,
  label,
  onClick,
}: {
  readonly children: JSX.Element;
  readonly disabled?: boolean;
  readonly label: string;
  readonly onClick: () => void;
}): JSX.Element {
  return (
    <IconButton
      label={label}
      tooltip={label}
      tooltipSide="bottom"
      size="md"
      className="text-content-secondary hover:bg-surface-hover hover:text-content-primary"
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </IconButton>
  );
}

function applyScaleAndCenter(instance: PanzoomObject, scale: number, animate: boolean): void {
  instance.zoom(scale, { animate, force: true });
  instance.pan(0, 0, { animate, force: true });
}

function readFitScale(stage: HTMLElement, image: NaturalImageSize): number {
  const width = Math.max(1, stage.clientWidth - ImageCanvasInset);
  const height = Math.max(1, stage.clientHeight - ImageCanvasInset);
  if (stage.clientWidth <= 0 || stage.clientHeight <= 0) return 1;
  return Math.min(1, width / image.width, height / image.height);
}

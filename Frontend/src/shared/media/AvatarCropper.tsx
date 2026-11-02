import { useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from "react";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { Slider } from "../ui";
import {
  AVATAR_PREVIEW_SIZE,
  normalizeAvatarCrop,
  resolveAvatarCropGeometry,
  type AvatarCropState,
  type LoadedAvatarImage,
} from "./useAvatarCrop";

export function AvatarCropper({
  crop,
  image,
  onCropChange,
}: {
  crop: AvatarCropState;
  image: LoadedAvatarImage | null;
  onCropChange: Dispatch<SetStateAction<AvatarCropState | null>>;
}): JSX.Element {
  const frameRef = useRef<HTMLDivElement>(null);
  const frameFocusPendingRef = useRef(true);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const geometry = useMemo(
    () => (image ? resolveAvatarCropGeometry(image, crop, AVATAR_PREVIEW_SIZE) : null),
    [crop, image],
  );

  const nudge = (deltaX: number, deltaY: number): void => {
    if (!image) return;
    onCropChange((current) =>
      current
        ? normalizeAvatarCrop(
            { ...current, offsetX: current.offsetX + deltaX, offsetY: current.offsetY + deltaY },
            image,
          )
        : current,
    );
  };

  useEffect(() => {
    if (!image) return;
    onCropChange((current) => (current ? normalizeAvatarCrop(current, image) : current));
  }, [image, onCropChange]);

  useEffect(() => {
    if (!image || !frameFocusPendingRef.current) return;
    frameFocusPendingRef.current = false;
    frameRef.current?.focus({ preventScroll: true });
  }, [image]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !image) return;
    const handleWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const delta = event.deltaY < 0 ? 0.05 : -0.05;
      onCropChange((current) =>
        current ? normalizeAvatarCrop({ ...current, scale: current.scale + delta }, image) : current,
      );
    };
    frame.addEventListener("wheel", handleWheel, { passive: false });
    return () => frame.removeEventListener("wheel", handleWheel);
  }, [image, onCropChange]);

  return (
    <div className="flex flex-col items-center">
      <div
        ref={frameRef}
        role="group"
        tabIndex={0}
        aria-label={frontendMessage("profile.cropPreview")}
        className={cn(
          "relative h-48 w-48 touch-none overflow-hidden rounded-full bg-ink-950 select-none",
          "shadow-[var(--shadow-avatar-cropper)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus",
          image ? "cursor-grab active:cursor-grabbing" : "cursor-default",
        )}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 16 : 4;
          if (event.key === "ArrowLeft") nudge(-step, 0);
          else if (event.key === "ArrowRight") nudge(step, 0);
          else if (event.key === "ArrowUp") nudge(0, -step);
          else if (event.key === "ArrowDown") nudge(0, step);
          else return;
          event.preventDefault();
        }}
        onPointerDown={(event) => {
          if (!image) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            offsetX: crop.offsetX,
            offsetY: crop.offsetY,
          };
        }}
        onPointerMove={(event) => {
          if (!image || !dragRef.current) return;
          const frame = frameRef.current;
          if (!frame) return;
          const unit = AVATAR_PREVIEW_SIZE / frame.clientWidth;
          const next = {
            ...crop,
            offsetX: dragRef.current.offsetX + (event.clientX - dragRef.current.x) * unit,
            offsetY: dragRef.current.offsetY + (event.clientY - dragRef.current.y) * unit,
          };
          onCropChange(normalizeAvatarCrop(next, image));
        }}
        onPointerUp={(event) => {
          if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
        }}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
      >
        {geometry ? (
          <img
            src={crop.source}
            alt=""
            draggable={false}
            className="absolute left-1/2 top-1/2 max-w-none"
            style={{
              width: geometry.width,
              height: geometry.height,
              transform: `translate(calc(-50% + ${geometry.offsetX}px), calc(-50% + ${geometry.offsetY}px))`,
            }}
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-[12px] text-paper-50/70">
            {frontendMessage("profile.loadingImage")}
          </div>
        )}
        <div className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-paper-50/65" />
      </div>

      <div className="mt-4 w-full">
        <div className="mb-2 flex items-center justify-between text-[12px] text-ink-500">
          <span>{frontendMessage("profile.zoom")}</span>
          <span className="tabular-nums">{Math.round(crop.scale * 100)}%</span>
        </div>
        <Slider
          ariaLabel={frontendMessage("profile.zoom")}
          size="compact"
          variant="scrubber"
          min={1}
          max={3}
          step={0.01}
          value={crop.scale}
          disabled={!image}
          onValueChange={(scale) => {
            if (!image) return;
            onCropChange((current) => (current ? normalizeAvatarCrop({ ...current, scale }, image) : current));
          }}
        />
      </div>
    </div>
  );
}

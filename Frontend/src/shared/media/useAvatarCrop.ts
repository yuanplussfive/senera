import { useEffect, useState } from "react";
import { toast } from "sonner";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";

export const MAX_AVATAR_SOURCE_BYTES = 8 * 1024 * 1024;
export const AVATAR_OUTPUT_SIZE = 256;
export const AVATAR_PREVIEW_SIZE = 192;
export const AVATAR_OUTPUT_QUALITY = 0.88;

export type AvatarCropState = {
  source: string;
  scale: number;
  offsetX: number;
  offsetY: number;
};

export type LoadedAvatarImage = {
  element: HTMLImageElement;
  width: number;
  height: number;
};

export function useLoadedAvatarImage(source: string | null): LoadedAvatarImage | null {
  const [image, setImage] = useState<LoadedAvatarImage | null>(null);

  useEffect(() => {
    let cancelled = false;
    setImage(null);
    if (!source) return;
    const element = new Image();
    element.onload = () => {
      if (cancelled) return;
      setImage({
        element,
        width: element.naturalWidth,
        height: element.naturalHeight,
      });
    };
    element.onerror = () => {
      if (!cancelled) toast.error(frontendMessage("profile.imageLoadFailed"));
    };
    element.src = source;
    return () => {
      cancelled = true;
    };
  }, [source]);

  return image;
}

export function resolveAvatarCropGeometry(
  image: LoadedAvatarImage,
  crop: AvatarCropState,
  frameSize = AVATAR_OUTPUT_SIZE,
): { width: number; height: number; offsetX: number; offsetY: number } {
  const baseScale = Math.max(frameSize / image.width, frameSize / image.height);
  const scale = baseScale * crop.scale;
  return {
    width: image.width * scale,
    height: image.height * scale,
    offsetX: crop.offsetX,
    offsetY: crop.offsetY,
  };
}

export function normalizeAvatarCrop(crop: AvatarCropState, image: LoadedAvatarImage): AvatarCropState {
  const scale = Math.min(3, Math.max(1, crop.scale));
  const geometry = resolveAvatarCropGeometry(image, { ...crop, scale }, AVATAR_PREVIEW_SIZE);
  const maxOffsetX = Math.max(0, (geometry.width - AVATAR_PREVIEW_SIZE) / 2);
  const maxOffsetY = Math.max(0, (geometry.height - AVATAR_PREVIEW_SIZE) / 2);
  const offsetX = Math.min(maxOffsetX, Math.max(-maxOffsetX, crop.offsetX));
  const offsetY = Math.min(maxOffsetY, Math.max(-maxOffsetY, crop.offsetY));

  if (scale === crop.scale && offsetX === crop.offsetX && offsetY === crop.offsetY) return crop;
  return {
    ...crop,
    scale,
    offsetX,
    offsetY,
  };
}

export function renderAvatarCrop(image: LoadedAvatarImage, crop: AvatarCropState): string {
  const normalized = normalizeAvatarCrop(crop, image);
  const previewGeometry = resolveAvatarCropGeometry(image, normalized, AVATAR_PREVIEW_SIZE);
  const geometry = {
    width: previewGeometry.width * (AVATAR_OUTPUT_SIZE / AVATAR_PREVIEW_SIZE),
    height: previewGeometry.height * (AVATAR_OUTPUT_SIZE / AVATAR_PREVIEW_SIZE),
  };
  const outputOffsetScale = AVATAR_OUTPUT_SIZE / AVATAR_PREVIEW_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_OUTPUT_SIZE;
  canvas.height = AVATAR_OUTPUT_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(frontendMessage("profile.imageLoadFailed"));

  ctx.clearRect(0, 0, AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE);
  ctx.drawImage(
    image.element,
    (AVATAR_OUTPUT_SIZE - geometry.width) / 2 + normalized.offsetX * outputOffsetScale,
    (AVATAR_OUTPUT_SIZE - geometry.height) / 2 + normalized.offsetY * outputOffsetScale,
    geometry.width,
    geometry.height,
  );

  return canvas.toDataURL("image/webp", AVATAR_OUTPUT_QUALITY);
}

export function readAvatarCrop(file: File): Promise<AvatarCropState> {
  if (!file.type.startsWith("image/")) return Promise.reject(new Error(frontendMessage("profile.imageRequired")));
  if (file.size > MAX_AVATAR_SOURCE_BYTES) return Promise.reject(new Error(frontendMessage("profile.imageTooLarge")));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return reject(new Error(frontendMessage("profile.avatarReadFailed")));
      resolve({ source: reader.result, scale: 1, offsetX: 0, offsetY: 0 });
    };
    reader.onerror = () => reject(new Error(frontendMessage("profile.avatarReadFailed")));
    reader.readAsDataURL(file);
  });
}

export function dataUrlToFile(dataUrl: string, fileName: string): File {
  const [header, encoded] = dataUrl.split(",", 2);
  if (!header || !encoded) throw new Error(frontendMessage("upload.failed"));
  const mime = /^data:([^;]+);base64$/i.exec(header)?.[1];
  if (!mime) throw new Error(frontendMessage("upload.failed"));
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  return new File([bytes], fileName, { type: mime });
}

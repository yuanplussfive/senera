import { useState } from "react";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { Dialog, DialogContent, DialogActions, DialogActionButton } from "../ui";
import { AvatarCropper } from "./AvatarCropper";
import { renderAvatarCrop, useLoadedAvatarImage, type AvatarCropState } from "./useAvatarCrop";

export function AvatarCropDialog({
  initialCrop,
  onCancel,
  onApply,
}: {
  initialCrop: AvatarCropState;
  onCancel(): void;
  onApply(dataUrl: string): Promise<void>;
}): JSX.Element {
  const [crop, setCrop] = useState<AvatarCropState | null>(initialCrop);
  const image = useLoadedAvatarImage(crop?.source ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  async function apply() {
    if (!image || !crop || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      await onApply(renderAvatarCrop(image, crop));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : frontendMessage("upload.failed"));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onCancel();
      }}
    >
      <DialogContent
        title={frontendMessage("profile.cropTitle")}
        description={frontendMessage("profile.cropDescription")}
        className="w-[min(440px,calc(100vw-28px))]"
        bodyClassName="overflow-y-auto px-6 pb-6"
        onEscapeKeyDown={(event) => {
          if (saving) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (saving) event.preventDefault();
        }}
        footer={
          <DialogActions>
            <DialogActionButton disabled={saving} onClick={onCancel}>
              {frontendMessage("profile.cancelCrop")}
            </DialogActionButton>
            <DialogActionButton
              variant="primary"
              disabled={!image || saving}
              loading={saving}
              onClick={() => void apply()}
            >
              {frontendMessage("profile.useAvatar")}
            </DialogActionButton>
          </DialogActions>
        }
      >
        {crop ? <AvatarCropper crop={crop} image={image} onCropChange={setCrop} /> : null}
        {error ? (
          <p role="alert" className="mt-4 text-xs text-brick-600">
            {error}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

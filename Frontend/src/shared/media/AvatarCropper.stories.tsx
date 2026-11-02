import { useState } from "react";
import { AvatarCropper } from "./AvatarCropper";
import { AvatarCropDialog } from "./AvatarCropDialog";
import { useLoadedAvatarImage, type AvatarCropState } from "./useAvatarCrop";
import { Button } from "../ui";

const initial: AvatarCropState = {
  source: `${import.meta.env.BASE_URL}icons/model-providers/deepseek.svg`,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
};

export const SharedCrop = () => {
  const [crop, setCrop] = useState<AvatarCropState | null>(initial);
  const image = useLoadedAvatarImage(crop?.source ?? null);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<string>();
  return (
    <main className="min-h-screen bg-surface-canvas p-6 text-content-primary">
      <div className="mx-auto max-w-sm space-y-5">
        <h1>个人与 Agent 共用头像裁剪</h1>
        <p className="text-xs text-content-muted">拖动定位、滚轮或滑块缩放，也可用方向键微调。</p>
        {crop ? <AvatarCropper crop={crop} image={image} onCropChange={setCrop} /> : null}
        <Button variant="outline" onClick={() => setOpen(true)}>
          打开裁剪窗口
        </Button>
        {preview ? <img src={preview} alt="裁剪后的头像" className="h-16 w-16 rounded-full" /> : null}
        {open ? (
          <AvatarCropDialog
            initialCrop={initial}
            onCancel={() => setOpen(false)}
            onApply={async (dataUrl) => {
              setPreview(dataUrl);
              setOpen(false);
            }}
          />
        ) : null}
      </div>
    </main>
  );
};

import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Info, Palette, Settings2, User } from "lucide-react";
import { toast } from "sonner";
import { openSettingsSurface } from "../../app/desktopBridge";
import type { UserProfile } from "../../store/sessionStore";
import { cn } from "../../lib/util";
import {
  Dialog,
  DialogActionButton,
  DialogActions,
  DialogContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../shared/ui";
import {
  AVATAR_PREVIEW_SIZE,
  MAX_AVATAR_SOURCE_BYTES,
  normalizeAvatarCrop,
  renderAvatarCrop,
  resolveAvatarCropGeometry,
  useLoadedAvatarImage,
  type AvatarCropState,
} from "./useAvatarCrop";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";

export function UserFooter({
  profile,
  socketStatus,
  onUpdateProfile,
  onLogout,
}: {
  profile: UserProfile;
  socketStatus: string;
  onUpdateProfile: (profile: Pick<UserProfile, "name" | "avatarDataUrl">) => void;
  onLogout: () => Promise<void>;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const statusLabel =
    socketStatus === "open"
      ? frontendMessage("connection.open")
      : socketStatus === "connecting" || socketStatus === "idle"
        ? frontendMessage("connection.connecting")
        : socketStatus === "error"
          ? frontendMessage("connection.error")
          : frontendMessage("connection.closed");
  const statusColor =
    socketStatus === "open"
      ? "bg-moss-500"
      : socketStatus === "connecting" || socketStatus === "idle"
        ? "bg-umber-500"
        : "bg-brick-500";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-14 w-full items-center gap-2 border-t border-ink-200/70 px-3 text-left transition hover:bg-ink-900/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-terra-300 data-[state=open]:bg-ink-900/[0.045]"
          >
            <UserAvatar profile={profile} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] text-ink-800">{profile.name}</div>
              <div className="flex items-center gap-1 text-[10.5px] text-ink-400">
                <span className={cn("inline-block h-1.5 w-1.5 rounded-full", statusColor)} />
                {statusLabel}
              </div>
            </div>
            <Settings2 className="h-3.5 w-3.5 shrink-0 text-ink-350" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" className="w-[244px]">
          <DropdownMenuLabel>
            {frontendMessage("runtime.migrated.features.session.ProfileFooter.77.30")}
          </DropdownMenuLabel>
          <DropdownMenuItem icon={<User className="h-3.5 w-3.5" />} onSelect={() => setOpen(true)}>
            {frontendMessage("runtime.migrated.features.session.ProfileFooter.82.13")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>
            {frontendMessage("runtime.migrated.features.session.ProfileFooter.85.30")}
          </DropdownMenuLabel>
          <DropdownMenuItem
            icon={<Palette className="h-3.5 w-3.5" />}
            onSelect={() => {
              void openSettingsSurface({
                section: "appearance",
                fallback: () => undefined,
              });
            }}
          >
            {frontendMessage("runtime.migrated.features.session.ProfileFooter.95.13")}
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={<Settings2 className="h-3.5 w-3.5" />}
            onSelect={() => {
              void openSettingsSurface({
                section: "general",
                fallback: () => undefined,
              });
            }}
          >
            {frontendMessage("runtime.migrated.features.session.ProfileFooter.106.13")}
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={<Info className="h-3.5 w-3.5" />}
            onSelect={() => {
              void openSettingsSurface({
                section: "about",
                fallback: () => undefined,
              });
            }}
          >
            {frontendMessage("runtime.migrated.features.session.ProfileFooter.117.13")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <div className="flex h-8 items-center gap-2 rounded-md px-2.5 text-[12px] text-ink-500">
            <span className={cn("inline-block h-1.5 w-1.5 rounded-full", statusColor)} />
            <span className="min-w-0 flex-1 truncate">
              {frontendMessage("runtime.migrated.features.session.ProfileFooter.122.55")}
            </span>
            <span className="text-[10.5px] text-ink-400">{statusLabel}</span>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      <ProfileDialog
        open={open}
        profile={profile}
        onOpenChange={setOpen}
        onSubmit={(next) => {
          onUpdateProfile(next);
          setOpen(false);
          toast.success(frontendMessage("profile.saved"));
        }}
        onLogout={async () => {
          try {
            await onLogout();
          } catch {
            toast.error(frontendMessage("auth.logoutFailed"));
          }
        }}
      />
    </>
  );
}

function UserAvatar({ profile, size = "normal" }: { profile: UserProfile; size?: "normal" | "large" }): JSX.Element {
  const className = size === "large" ? "h-14 w-14 rounded-full text-[18px]" : "h-8 w-8 rounded-full text-[12px]";
  const initial = profile.name.trim().slice(0, 1).toUpperCase();

  return (
    <div
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden bg-ink-900 font-semibold text-paper-50 ring-1 ring-ink-900/10",
        className,
      )}
    >
      {profile.avatarDataUrl ? (
        <img src={profile.avatarDataUrl} alt={profile.name} className="h-full w-full object-cover" />
      ) : initial ? (
        initial
      ) : (
        <User className={size === "large" ? "h-5 w-5" : "h-3.5 w-3.5"} />
      )}
    </div>
  );
}

function ProfileDialog({
  open,
  profile,
  onOpenChange,
  onSubmit,
  onLogout,
}: {
  open: boolean;
  profile: UserProfile;
  onOpenChange: (open: boolean) => void;
  onSubmit: (profile: Pick<UserProfile, "name" | "avatarDataUrl">) => void;
  onLogout: () => Promise<void>;
}): JSX.Element {
  const [draftName, setDraftName] = useState(profile.name);
  const [draftAvatar, setDraftAvatar] = useState<string | null>(profile.avatarDataUrl);
  const [crop, setCrop] = useState<AvatarCropState | null>(null);

  const resetDraft = (): void => {
    setDraftName(profile.name);
    setDraftAvatar(profile.avatarDataUrl);
    setCrop(null);
  };

  const readAvatarFile = (file: File): void => {
    if (!file.type.startsWith("image/")) {
      toast.error(frontendMessage("profile.imageRequired"));
      return;
    }
    if (file.size > MAX_AVATAR_SOURCE_BYTES) {
      toast.error(frontendMessage("profile.imageTooLarge"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (result) {
        setCrop({
          source: result,
          scale: 1,
          offsetX: 0,
          offsetY: 0,
        });
      }
    };
    reader.onerror = () => toast.error(frontendMessage("profile.avatarReadFailed"));
    reader.readAsDataURL(file);
  };

  const applyCroppedAvatar = (dataUrl: string): void => {
    setDraftAvatar(dataUrl);
    setCrop(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) resetDraft();
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        title={frontendMessage("profile.title")}
        description={frontendMessage("profile.description")}
        className="w-[min(420px,calc(100vw-28px))]"
        bodyClassName="p-4"
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const name = draftName.trim();
            if (!name) {
              toast.error(frontendMessage("profile.nameRequired"));
              return;
            }
            if (crop) {
              toast.error(frontendMessage("profile.avatarCropRequired"));
              return;
            }
            onSubmit({ name, avatarDataUrl: draftAvatar });
          }}
        >
          {crop ? (
            <AvatarCropper
              crop={crop}
              onCropChange={setCrop}
              onCancel={() => setCrop(null)}
              onApply={applyCroppedAvatar}
            />
          ) : (
            <AvatarPicker
              name={draftName || profile.name}
              avatarDataUrl={draftAvatar}
              updatedAt={profile.updatedAt}
              onReadFile={readAvatarFile}
              onRemove={() => setDraftAvatar(null)}
            />
          )}

          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-ink-600">
              {frontendMessage("profile.displayName")}
            </span>
            <input
              autoFocus
              value={draftName}
              maxLength={48}
              onChange={(event) => setDraftName(event.target.value)}
              className="h-10 w-full rounded-lg border border-ink-200 bg-paper-50 px-3 text-[13px] text-ink-900 outline-none transition placeholder:text-ink-300 focus:border-ink-300 focus:ring-2 focus:ring-terra-200/50"
              placeholder={frontendMessage("profile.namePlaceholder")}
            />
          </label>

          <DialogActions>
            <DialogActionButton className="mr-auto text-brick-700 hover:bg-brick-50" onClick={() => void onLogout()}>
              {frontendMessage("auth.signOut")}
            </DialogActionButton>
            <DialogActionButton close>{frontendMessage("ui.cancel")}</DialogActionButton>
            <DialogActionButton type="submit" variant="primary">
              {frontendMessage("profile.save")}
            </DialogActionButton>
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AvatarPicker({
  name,
  avatarDataUrl,
  updatedAt,
  onReadFile,
  onRemove,
}: {
  name: string;
  avatarDataUrl: string | null;
  updatedAt: string;
  onReadFile: (file: File) => void;
  onRemove: () => void;
}): JSX.Element {
  return (
    <div className="overflow-hidden rounded-lg border border-ink-200/70 bg-paper-100/65">
      <div className="flex items-center gap-4 p-3">
        <UserAvatar profile={{ name, avatarDataUrl, updatedAt }} size="large" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-ink-900">{frontendMessage("profile.avatar")}</div>
          <div className="mt-1 text-[12px] leading-5 text-ink-500">{frontendMessage("profile.avatarHint")}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md bg-ink-900 px-3 text-[12.5px] font-medium text-paper-50 transition hover:bg-ink-800">
              <Camera className="h-3.5 w-3.5" />
              {frontendMessage("profile.selectImage")}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="sr-only"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  if (file) onReadFile(file);
                }}
              />
            </label>
            {avatarDataUrl ? (
              <button
                type="button"
                onClick={onRemove}
                className="h-8 rounded-md px-2.5 text-[12.5px] text-ink-500 transition hover:bg-ink-900/[0.05] hover:text-ink-900"
              >
                {frontendMessage("profile.removeAvatar")}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function AvatarCropper({
  crop,
  onCropChange,
  onApply,
  onCancel,
}: {
  crop: AvatarCropState;
  onCropChange: (crop: AvatarCropState) => void;
  onApply: (dataUrl: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const image = useLoadedAvatarImage(crop.source);
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const geometry = useMemo(
    () => (image ? resolveAvatarCropGeometry(image, crop, AVATAR_PREVIEW_SIZE) : null),
    [crop, image],
  );

  useEffect(() => {
    if (!image) return;
    const normalized = normalizeAvatarCrop(crop, image);
    if (normalized !== crop) onCropChange(normalized);
  }, [crop, image, onCropChange]);

  const updateScale = (scale: number): void => {
    if (!image) return;
    onCropChange(normalizeAvatarCrop({ ...crop, scale }, image));
  };

  const handleApply = (): void => {
    if (!image) return;
    onApply(renderAvatarCrop(image, crop));
  };

  return (
    <div className="rounded-lg border border-ink-200/70 bg-paper-100/65 p-3">
      <div className="flex flex-col items-center">
        <div
          ref={frameRef}
          className={cn(
            "relative h-48 w-48 touch-none overflow-hidden rounded-full bg-ink-950 select-none",
            "shadow-[var(--shadow-avatar-cropper)]",
          )}
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
          onWheel={(event) => {
            if (!image) return;
            event.preventDefault();
            const nextScale = crop.scale + (event.deltaY < 0 ? 0.05 : -0.05);
            updateScale(nextScale);
          }}
        >
          {geometry ? (
            <img
              src={crop.source}
              alt={frontendMessage("profile.cropPreview")}
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

        <label className="mt-4 w-full">
          <div className="mb-2 flex items-center justify-between text-[12px] text-ink-500">
            <span>{frontendMessage("profile.zoom")}</span>
            <span className="font-mono">{Math.round(crop.scale * 100)}%</span>
          </div>
          <input
            type="range"
            min="1"
            max="3"
            step="0.01"
            value={crop.scale}
            onChange={(event) => updateScale(Number(event.target.value))}
            className="h-1.5 w-full cursor-pointer accent-ink-900"
          />
        </label>

        <div className="mt-4 flex w-full justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-8 rounded-md px-3 text-[12.5px] text-ink-600 transition hover:bg-ink-900/[0.05] hover:text-ink-900"
          >
            {frontendMessage("profile.cancelCrop")}
          </button>
          <button
            type="button"
            disabled={!image}
            onClick={handleApply}
            className="h-8 rounded-md bg-ink-900 px-3 text-[12.5px] font-medium text-paper-50 transition hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {frontendMessage("profile.useAvatar")}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  Info,
  LoaderCircle,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  User,
  UserRoundPen,
  Wifi,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";
import type { SandboxRuntimeState, SandboxStatusSnapshotData } from "../../api/eventTypes";
import { sandboxStatusDetail } from "../sandbox/sandboxPreparationPresentation";
import type { UserProfile } from "../../store/sessionStore";
import type { SettingsSectionId } from "../settings/types";
import { cn } from "../../lib/util";
import {
  Dialog,
  DialogActionButton,
  DialogActions,
  DialogContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuMeta,
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
  collapsed = false,
  profile,
  socketStatus,
  sandboxStatus,
  onUpdateProfile,
  onLogout,
  onOpenSettings,
}: {
  collapsed?: boolean;
  profile: UserProfile;
  socketStatus: string;
  sandboxStatus?: SandboxStatusSnapshotData | null;
  onUpdateProfile: (profile: Pick<UserProfile, "name" | "avatarDataUrl">) => void;
  onLogout?: () => Promise<void>;
  onOpenSettings: (section?: SettingsSectionId, returnFocus?: HTMLElement | null) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const settingsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const statusLabel =
    socketStatus === "open"
      ? frontendMessage("connection.open")
      : socketStatus === "connecting" || socketStatus === "idle"
        ? frontendMessage("connection.connecting")
        : socketStatus === "error"
          ? frontendMessage("connection.error")
          : frontendMessage("connection.closed");
  const StatusIcon =
    socketStatus === "open" ? Wifi : socketStatus === "connecting" || socketStatus === "idle" ? LoaderCircle : WifiOff;
  const statusIconClass =
    socketStatus === "open"
      ? "text-moss-600"
      : socketStatus === "connecting" || socketStatus === "idle"
        ? "animate-spin text-umber-600"
        : "text-brick-600";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            ref={settingsTriggerRef}
            type="button"
            className={cn(
              "mt-auto w-full transition-colors duration-150 hover:bg-surface-hover data-[state=open]:bg-surface-hover",
              collapsed
                ? "grid h-12 place-items-center border-t-0 px-0"
                : "flex h-[48px] items-center gap-2 border-t border-line-subtle px-3 text-left",
            )}
          >
            <UserAvatar profile={profile} />
            {collapsed ? null : (
              <>
                <div className="min-w-0 flex-1 truncate text-[13px] text-content-primary">{profile.name}</div>
                <Settings className="h-3.5 w-3.5 shrink-0 text-content-muted" />
              </>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align={collapsed ? "end" : "start"}
          side={collapsed ? "right" : "top"}
          collisionPadding={8}
          className="w-[220px]"
        >
          <DropdownMenuItem icon={<UserRoundPen className="h-3.5 w-3.5" />} onSelect={() => setOpen(true)}>
            {frontendMessage("profile.menu.edit")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            icon={<Settings className="h-3.5 w-3.5" />}
            onSelect={() => onOpenSettings(undefined, settingsTriggerRef.current)}
          >
            {frontendMessage("profile.menu.settings")}
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={<Info className="h-3.5 w-3.5" />}
            onSelect={() => onOpenSettings("about", settingsTriggerRef.current)}
          >
            {frontendMessage("profile.menu.about")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuMeta
            aria-live="polite"
            icon={<StatusIcon className={cn("h-3.5 w-3.5", statusIconClass)} aria-hidden="true" />}
            value={statusLabel}
          >
            {frontendMessage("runtime.migrated.features.session.ProfileFooter.122.55")}
          </DropdownMenuMeta>
          <SandboxStatusMeta status={sandboxStatus} />
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
        onLogout={
          onLogout
            ? async () => {
                try {
                  await onLogout();
                } catch {
                  toast.error(frontendMessage("auth.logoutFailed"));
                }
              }
            : undefined
        }
      />
    </>
  );
}

function SandboxStatusMeta({ status }: { status?: SandboxStatusSnapshotData | null }): JSX.Element {
  const state = status?.state ?? "unknown";
  const detail = sandboxStatusDetail(status);
  const suffix =
    status?.effectiveMode === "sandbox"
      ? frontendMessage("sandbox.status.sandboxSuffix")
      : status?.effectiveMode === "disabled"
        ? frontendMessage("sandbox.status.disabledSuffix")
        : frontendMessage("sandbox.status.unavailableSuffix");
  const table = {
    disabled: {
      label: frontendMessage("sandbox.status.disabled"),
      Icon: Shield,
      className: "text-content-muted",
    },
    unknown: {
      label: frontendMessage("sandbox.status.unknown"),
      Icon: Shield,
      className: "text-content-muted",
    },
    preparing: {
      label: frontendMessage("sandbox.status.preparing"),
      Icon: Shield,
      className: "text-umber-600",
    },
    ready: {
      label: frontendMessage("sandbox.status.ready"),
      Icon: ShieldCheck,
      className: "text-moss-600",
    },
    unavailable: {
      label: frontendMessage("sandbox.status.unavailable"),
      Icon: ShieldAlert,
      className: "text-brick-600",
    },
  } satisfies Record<
    SandboxRuntimeState,
    {
      label: string;
      Icon: typeof Shield;
      className: string;
    }
  >;
  const presentation = table[state];
  const StatusIcon = presentation.Icon;

  return (
    <DropdownMenuMeta
      aria-label={`${frontendMessage("sandbox.status.label")}: ${presentation.label}`}
      title={`${detail} ${suffix}`}
      icon={<StatusIcon className={`h-3.5 w-3.5 ${presentation.className}`} aria-hidden="true" />}
      value={presentation.label}
      data-sandbox-status={state}
    >
      {frontendMessage("sandbox.status.label")}
    </DropdownMenuMeta>
  );
}

function UserAvatar({ profile, size = "normal" }: { profile: UserProfile; size?: "normal" | "large" }): JSX.Element {
  const className = size === "large" ? "h-14 w-14 rounded-full text-[18px]" : "h-8 w-8 rounded-full text-[12px]";
  const initial = profile.name.trim().slice(0, 1).toUpperCase();

  return (
    <div
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden bg-content-strong font-semibold text-content-inverse ring-1 ring-line-subtle",
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
  onLogout?: () => Promise<void>;
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
        bodyClassName="px-6 pb-6"
      >
        <form
          className="space-y-0"
          data-profile-editor
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

          <label className="mt-5 block border-t border-ink-200/70 pt-5">
            <span className="mb-1.5 block text-[12px] font-medium text-ink-600">
              {frontendMessage("profile.displayName")}
            </span>
            <input
              autoFocus
              value={draftName}
              maxLength={48}
              onChange={(event) => setDraftName(event.target.value)}
              className="h-10 w-full rounded-lg border border-ink-200 bg-paper-50 px-3 text-[13px] text-ink-900 outline-none transition placeholder:text-ink-300 focus:border-ink-300 focus:ring-2 focus:ring-accent-focus"
              placeholder={frontendMessage("profile.namePlaceholder")}
            />
          </label>

          <DialogActions className="mt-6">
            {onLogout ? (
              <DialogActionButton
                className="mr-auto border-0 bg-transparent px-2 text-brick-600 shadow-none hover:bg-transparent hover:text-brick-700"
                onClick={() => void onLogout()}
              >
                {frontendMessage("auth.signOut")}
              </DialogActionButton>
            ) : null}
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
    <div className="flex items-center gap-4 py-1">
      <UserAvatar profile={{ name, avatarDataUrl, updatedAt }} size="large" />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-ink-900">{frontendMessage("profile.avatar")}</div>
        <div className="mt-0.5 text-[12px] leading-5 text-ink-500">{frontendMessage("profile.avatarHint")}</div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-ink-200 bg-paper-50 px-3 text-[12.5px] font-medium text-ink-700 transition-colors hover:border-ink-300 hover:bg-ink-900/[0.035] hover:text-ink-900">
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
              className="h-8 cursor-pointer rounded-md px-2.5 text-[12.5px] text-ink-500 transition-colors hover:bg-ink-900/[0.05] hover:text-ink-900"
            >
              {frontendMessage("profile.removeAvatar")}
            </button>
          ) : null}
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

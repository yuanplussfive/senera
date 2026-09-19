import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import type { UserProfile } from "../../store/sessionStore";
import type { SettingsSectionId } from "../settings/types";
import { cn } from "../../lib/util";
import {
  AppIcon,
  Button,
  Dialog,
  DialogActionButton,
  DialogActions,
  DialogContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  FileDropZone,
  FormField,
  FormHint,
  FormLabel,
  Input,
  type FileDropZoneAccept,
} from "../../shared/ui";
import {
  AVATAR_PREVIEW_SIZE,
  MAX_AVATAR_SOURCE_BYTES,
  normalizeAvatarCrop,
  renderAvatarCrop,
  resolveAvatarCropGeometry,
  useLoadedAvatarImage,
  type AvatarCropState,
  type LoadedAvatarImage,
} from "./useAvatarCrop";
import { FrontendLocalePreferences, FrontendLocales, frontendMessage } from "../../i18n/frontendMessageCatalog";
import { useFrontendLocalePreference, useSetFrontendLocalePreference } from "../../i18n/useFrontendLocale";
import { themeModeLabels } from "../../shared/theme/appearancePresentation";
import { type ThemeMode } from "../../shared/theme/themeModel";
import { useAppearance, useSetAppearancePreference } from "../../shared/theme/useAppearance";

const themeModeOptions = ["system", "light", "dark"] as const satisfies readonly ThemeMode[];

const MAX_DISPLAY_NAME_LENGTH = 48;
/** Start warning about the name limit this many characters before it truncates. */
const DISPLAY_NAME_COUNTER_THRESHOLD = MAX_DISPLAY_NAME_LENGTH - 8;

const avatarImageAccept: FileDropZoneAccept = {
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/webp": [".webp"],
  "image/gif": [".gif"],
};

export function UserFooter({
  collapsed = false,
  compactFrame = false,
  profile,
  onUpdateProfile,
  onLogout,
  onSettingsIntent,
  onOpenSettings,
}: {
  collapsed?: boolean;
  compactFrame?: boolean;
  profile: UserProfile;
  socketStatus: string;
  onUpdateProfile: (profile: Pick<UserProfile, "name" | "avatarDataUrl">) => void;
  onLogout?: () => Promise<void>;
  onSettingsIntent?: () => void;
  onOpenSettings: (section?: SettingsSectionId, returnFocus?: HTMLElement | null) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const settingsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const openProfileAfterMenuCloseRef = useRef(false);
  const localePreference = useFrontendLocalePreference();
  const setLocalePreference = useSetFrontendLocalePreference();
  const { preference: appearancePreference } = useAppearance();
  const setAppearancePreference = useSetAppearancePreference();
  useEffect(() => {
    if (menuOpen || !openProfileAfterMenuCloseRef.current) return;
    openProfileAfterMenuCloseRef.current = false;
    setOpen(true);
  }, [menuOpen]);

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <div
          className={cn(
            "mt-auto shrink-0 bg-transparent transition-colors duration-150 hover:bg-surface-hover",
            menuOpen && "bg-surface-hover",
            compactFrame &&
              "-mx-[10px] -mb-[10px] w-[calc(100%+20px)] border-t border-line-subtle px-[10px] pb-[10px] pt-2.5",
            !compactFrame && !collapsed && "border-t border-line-subtle",
          )}
        >
          <DropdownMenuTrigger asChild>
            <button
              ref={settingsTriggerRef}
              type="button"
              onPointerEnter={onSettingsIntent}
              onPointerDown={onSettingsIntent}
              onFocus={onSettingsIntent}
              className={cn(
                "w-full bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-focus",
                collapsed ? "grid h-12 place-items-center px-0" : "flex h-[48px] items-center gap-2 px-3 text-left",
              )}
            >
              <UserAvatar profile={profile} />
              {collapsed ? null : (
                <>
                  <div className="min-w-0 flex-1 truncate text-[13px] text-content-primary">{profile.name}</div>
                  <AppIcon
                    icon="account-menu"
                    className={cn(
                      "h-3.5 w-3.5 shrink-0 text-content-muted transition-transform duration-150",
                      menuOpen && "rotate-180",
                    )}
                  />
                </>
              )}
            </button>
          </DropdownMenuTrigger>
        </div>
        <DropdownMenuContent
          align={collapsed ? "end" : "start"}
          side={collapsed ? "right" : "top"}
          sideOffset={12}
          collisionPadding={8}
          className="w-[220px]"
        >
          <DropdownMenuItem
            className="gap-1.5"
            icon={<AppIcon icon="user-round-pen" className="h-3.5 w-3.5 text-content-primary" />}
            onSelect={() => {
              openProfileAfterMenuCloseRef.current = true;
            }}
          >
            {frontendMessage("profile.menu.userSettings")}
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger
              className="gap-1.5"
              icon={<AppIcon icon="sun-moon" className="h-3.5 w-3.5 text-content-primary" />}
            >
              {frontendMessage("profile.menu.theme")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-[200px]">
              {themeModeOptions.map((mode) => (
                <DropdownMenuItem
                  key={mode}
                  trailing={
                    appearancePreference.themeMode === mode ? (
                      <AppIcon icon="checkmark" size={15} className="text-content-primary" />
                    ) : undefined
                  }
                  onClick={() => setAppearancePreference({ themeMode: mode })}
                >
                  {themeModeLabels[mode]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger
              className="gap-1.5"
              icon={<AppIcon icon="language" className="h-3.5 w-3.5 text-content-primary" />}
            >
              {frontendMessage("profile.menu.language")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-[200px]">
              <DropdownMenuItem
                trailing={
                  localePreference === FrontendLocalePreferences.System ? (
                    <AppIcon icon="checkmark" size={15} className="text-content-primary" />
                  ) : undefined
                }
                onClick={() => setLocalePreference(FrontendLocalePreferences.System)}
              >
                {frontendMessage("profile.menu.language.system")}
              </DropdownMenuItem>
              <DropdownMenuItem
                trailing={
                  localePreference === FrontendLocales.ZhCn ? (
                    <AppIcon icon="checkmark" size={15} className="text-content-primary" />
                  ) : undefined
                }
                onClick={() => setLocalePreference(FrontendLocales.ZhCn)}
              >
                {frontendMessage("profile.menu.language.zhCn")}
              </DropdownMenuItem>
              <DropdownMenuItem
                trailing={
                  localePreference === FrontendLocales.EnUs ? (
                    <AppIcon icon="checkmark" size={15} className="text-content-primary" />
                  ) : undefined
                }
                onClick={() => setLocalePreference(FrontendLocales.EnUs)}
              >
                {frontendMessage("profile.menu.language.enUs")}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem
            className="gap-1.5"
            icon={<AppIcon icon="settings" className="h-3.5 w-3.5 text-content-primary" />}
            onSelect={() => onOpenSettings(undefined, settingsTriggerRef.current)}
          >
            {frontendMessage("profile.menu.settings")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ProfileDialog
        open={open}
        profile={profile}
        returnFocus={settingsTriggerRef.current}
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

function UserAvatar({ profile, size = "normal" }: { profile: UserProfile; size?: "normal" | "hero" }): JSX.Element {
  const className = size === "hero" ? "h-20 w-20 rounded-full text-[24px]" : "h-8 w-8 rounded-full text-[12px]";
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
        <AppIcon icon="user" className={size === "hero" ? "h-6 w-6" : "h-3.5 w-3.5"} />
      )}
    </div>
  );
}

function ProfileDialog({
  open,
  profile,
  returnFocus,
  onOpenChange,
  onSubmit,
  onLogout,
}: {
  open: boolean;
  profile: UserProfile;
  returnFocus: HTMLElement | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (profile: Pick<UserProfile, "name" | "avatarDataUrl">) => void;
  onLogout?: () => Promise<void>;
}): JSX.Element {
  const [draftName, setDraftName] = useState(profile.name);
  const [draftAvatar, setDraftAvatar] = useState<string | null>(profile.avatarDataUrl);
  const [crop, setCrop] = useState<AvatarCropState | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const avatarButtonRef = useRef<HTMLButtonElement>(null);
  const cropWasActiveRef = useRef(false);
  const cropImage = useLoadedAvatarImage(crop?.source ?? null);
  const nameMissing = draftName.trim().length === 0;

  useEffect(() => {
    if (open) nameInputRef.current?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (crop) {
      cropWasActiveRef.current = true;
      return;
    }
    if (!cropWasActiveRef.current || !open) return;
    cropWasActiveRef.current = false;
    avatarButtonRef.current?.focus({ preventScroll: true });
  }, [crop, open]);

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

  const applyCrop = (): void => {
    if (!crop || !cropImage) return;
    setDraftAvatar(renderAvatarCrop(cropImage, crop));
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
        title={crop ? frontendMessage("profile.cropTitle") : frontendMessage("profile.title")}
        description={crop ? frontendMessage("profile.cropDescription") : undefined}
        className="w-[min(440px,calc(100vw-28px))]"
        bodyClassName="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-6 pb-6"
        footerClassName="border-t border-line-subtle bg-surface-subtle/35"
        footer={
          crop ? (
            <DialogActions>
              <DialogActionButton onClick={() => setCrop(null)}>
                {frontendMessage("profile.cancelCrop")}
              </DialogActionButton>
              <DialogActionButton type="submit" form="profile-crop-form" variant="primary" disabled={!cropImage}>
                {frontendMessage("profile.useAvatar")}
              </DialogActionButton>
            </DialogActions>
          ) : (
            <DialogActions>
              {onLogout ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mr-auto text-brick-600 hover:text-brick-700"
                  onClick={() => void onLogout()}
                >
                  {frontendMessage("auth.signOut")}
                </Button>
              ) : null}
              <DialogActionButton close>{frontendMessage("ui.cancel")}</DialogActionButton>
              <DialogActionButton type="submit" form="profile-editor-form" variant="primary" disabled={nameMissing}>
                {frontendMessage("profile.save")}
              </DialogActionButton>
            </DialogActions>
          )
        }
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          nameInputRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          if (!returnFocus?.isConnected) return;
          event.preventDefault();
          returnFocus.focus();
        }}
        onEscapeKeyDown={(event) => {
          if (!crop) {
            onOpenChange(false);
            return;
          }
          event.preventDefault();
          setCrop(null);
        }}
      >
        {crop ? (
          <form
            id="profile-crop-form"
            onSubmit={(event) => {
              event.preventDefault();
              applyCrop();
            }}
          >
            <AvatarCropper crop={crop} image={cropImage} onCropChange={setCrop} />
          </form>
        ) : (
          <form
            id="profile-editor-form"
            className="grid gap-6"
            onSubmit={(event) => {
              event.preventDefault();
              const name = draftName.trim();
              if (!name) {
                toast.error(frontendMessage("profile.nameRequired"));
                return;
              }
              onSubmit({ name, avatarDataUrl: draftAvatar });
            }}
          >
            <FileDropZone
              accept={avatarImageAccept}
              multiple={false}
              className="rounded-xl border border-dashed border-line-subtle bg-surface-subtle/45 p-5 transition-colors"
              onFiles={(files, rejections) => {
                const file = files[0];
                if (file) {
                  readAvatarFile(file);
                  return;
                }
                if (rejections.length > 0) toast.error(frontendMessage("profile.imageRequired"));
              }}
            >
              {({ isDragActive, isDragReject, open: openFilePicker }) => (
                <div
                  className={cn(
                    "flex flex-col items-center rounded-lg px-1 py-0.5 transition-colors",
                    isDragActive && !isDragReject && "bg-accent-surface/70",
                    isDragReject && "bg-brick-50/70",
                  )}
                >
                  <FormLabel className="sr-only">{frontendMessage("profile.avatar")}</FormLabel>
                  <button
                    ref={avatarButtonRef}
                    type="button"
                    onClick={openFilePicker}
                    aria-label={frontendMessage("profile.avatarChange")}
                    className={cn(
                      "group relative h-20 w-20 cursor-pointer rounded-full",
                      "ring-4 ring-surface-panel shadow-soft transition-[transform,box-shadow] duration-150 ease-out active:scale-[0.97]",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus",
                    )}
                  >
                    <UserAvatar
                      profile={{
                        name: draftName.trim() || profile.name,
                        avatarDataUrl: draftAvatar,
                        updatedAt: profile.updatedAt,
                      }}
                      size="hero"
                    />
                    <span
                      className={cn(
                        "pointer-events-none absolute inset-0 grid place-items-center rounded-full bg-ink-950/55 text-paper-50",
                        "opacity-0 transition-opacity duration-150 ease-out",
                        "group-hover:opacity-100 group-focus-visible:opacity-100",
                        isDragActive && !isDragReject && "opacity-100",
                      )}
                    >
                      <AppIcon icon="camera" className="h-5 w-5" aria-hidden="true" />
                    </span>
                  </button>

                  {isDragReject ? (
                    <FormHint className="mt-4 max-w-[290px] text-center leading-5 text-brick-600">
                      {frontendMessage("profile.imageRequired")}
                    </FormHint>
                  ) : null}

                  <div className="mt-4 flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={openFilePicker}>
                      <AppIcon icon="camera" className="h-3.5 w-3.5" aria-hidden="true" />
                      {frontendMessage("profile.selectImage")}
                    </Button>
                    {draftAvatar ? (
                      <Button size="sm" variant="ghost" onClick={() => setDraftAvatar(null)}>
                        <AppIcon icon="trash" className="h-3.5 w-3.5" aria-hidden="true" />
                        {frontendMessage("profile.removeAvatar")}
                      </Button>
                    ) : null}
                  </div>
                </div>
              )}
            </FileDropZone>

            <FormField className="border-t border-line-subtle pt-5">
              <div className="flex items-center justify-between gap-3">
                <FormLabel>{frontendMessage("profile.displayName")}</FormLabel>
                {draftName.length >= DISPLAY_NAME_COUNTER_THRESHOLD ? (
                  <span
                    className={cn(
                      "text-[11.5px] tabular-nums text-content-muted",
                      draftName.length >= MAX_DISPLAY_NAME_LENGTH && "text-brick-600",
                    )}
                  >
                    {draftName.length}/{MAX_DISPLAY_NAME_LENGTH}
                  </span>
                ) : null}
              </div>
              <Input
                ref={nameInputRef}
                aria-label={frontendMessage("profile.displayName")}
                aria-invalid={nameMissing}
                aria-describedby={nameMissing ? "profile-name-error" : undefined}
                value={draftName}
                maxLength={MAX_DISPLAY_NAME_LENGTH}
                placeholder={frontendMessage("profile.namePlaceholder")}
                className="h-10 text-[13px]"
                onChange={(event) => setDraftName(event.target.value)}
              />
              {nameMissing ? (
                <FormHint className="text-brick-600">
                  <span id="profile-name-error">{frontendMessage("profile.nameRequired")}</span>
                </FormHint>
              ) : null}
            </FormField>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AvatarCropper({
  crop,
  image,
  onCropChange,
}: {
  crop: AvatarCropState;
  image: LoadedAvatarImage | null;
  onCropChange: Dispatch<SetStateAction<AvatarCropState | null>>;
}): JSX.Element {
  const frameRef = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<HTMLInputElement>(null);
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

      <label className="mt-4 w-full">
        <div className="mb-2 flex items-center justify-between text-[12px] text-ink-500">
          <span>{frontendMessage("profile.zoom")}</span>
          <span className="tabular-nums">{Math.round(crop.scale * 100)}%</span>
        </div>
        <input
          ref={sliderRef}
          type="range"
          min="1"
          max="3"
          step="0.01"
          value={crop.scale}
          disabled={!image}
          onChange={(event) => {
            const scale = Number(event.target.value);
            if (!image) return;
            onCropChange((current) => (current ? normalizeAvatarCrop({ ...current, scale }, image) : current));
          }}
          className="h-1.5 w-full cursor-pointer rounded-full accent-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus"
        />
      </label>
    </div>
  );
}

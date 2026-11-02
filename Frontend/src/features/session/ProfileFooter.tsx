import { lazy, Suspense, useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { readMobileBridge } from "../../app/mobileBridge";
import { toast } from "sonner";
import type { SocketStatus } from "../../api/useAgentSocket";
import { SocketConnectionNotice } from "./SocketConnectionNotice";
import type { ConversationIdentity, ConversationProfileUpdate, UserProfile } from "../../store/sessionStore";
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
  readAvatarCrop,
  dataUrlToFile,
  renderAvatarCrop,
  useLoadedAvatarImage,
  type AvatarCropState,
} from "../../shared/media/useAvatarCrop";
import { AvatarCropper } from "../../shared/media/AvatarCropper";
import { ProfileIdentityAvatar } from "./ProfileAvatar";
import { saveProfileAvatar } from "../../api/profileAvatarClient";
import { FrontendLocalePreferences, FrontendLocales, frontendMessage } from "../../i18n/frontendMessageCatalog";
import { useFrontendLocalePreference, useSetFrontendLocalePreference } from "../../i18n/useFrontendLocale";
import { themeModeLabels } from "../../shared/theme/appearancePresentation";
import { type ThemeMode } from "../../shared/theme/themeModel";
import { useAppearance, useSetAppearancePreference } from "../../shared/theme/useAppearance";

const themeModeOptions = ["system", "light", "dark"] as const satisfies readonly ThemeMode[];
const LazyDeviceConnectionsDialog = lazy(() =>
  import("./DeviceConnectionsDialog").then((module) => ({ default: module.DeviceConnectionsDialog })),
);

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
  socketStatus,
  onReconnectSocket,
  onUpdateProfile,
  onLogout,
  onSettingsIntent,
  onOpenSettings,
  httpBaseUrl,
  uploadCsrfToken,
}: {
  collapsed?: boolean;
  compactFrame?: boolean;
  profile: UserProfile;
  socketStatus: SocketStatus;
  onReconnectSocket?: () => void;
  onUpdateProfile: (profile: ConversationProfileUpdate) => void;
  onLogout?: () => Promise<void>;
  onSettingsIntent?: () => void;
  onOpenSettings: (section?: SettingsSectionId, returnFocus?: HTMLElement | null) => void;
  httpBaseUrl?: string;
  uploadCsrfToken?: string;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [devicesOpen, setDevicesOpen] = useState(false);
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
    <div className="mt-auto shrink-0">
      <SocketConnectionNotice status={socketStatus} onReconnect={onReconnectSocket} collapsed={collapsed} />
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <div
          className={cn(
            "mt-auto shrink-0 bg-transparent transition-colors duration-150 hover:bg-surface-hover",
            menuOpen && "bg-surface-hover",
            compactFrame && "-mx-3 -mb-3 w-[calc(100%+1.5rem)] border-t border-line-subtle px-3 pb-3 pt-3",
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
                collapsed ? "grid h-[52px] place-items-center px-0" : "flex h-[52px] items-center gap-2 px-3 text-left",
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
          {httpBaseUrl ? (
            <DropdownMenuItem icon={<AppIcon icon="link" size={14} />} onSelect={() => setDevicesOpen(true)}>
              {frontendMessage("mobile.connectPhone")}
            </DropdownMenuItem>
          ) : null}
          {readMobileBridge() ? (
            <DropdownMenuItem
              icon={<AppIcon icon="server" size={14} />}
              onSelect={() => {
                void readMobileBridge()!.openConnections();
              }}
            >
              {frontendMessage("mobile.switchComputer")}
            </DropdownMenuItem>
          ) : null}
          {readMobileBridge()?.openBackgroundSettings ? (
            <DropdownMenuItem
              icon={<AppIcon icon="settings" size={14} />}
              onSelect={() => {
                void readMobileBridge()!.openBackgroundSettings!().catch((error: unknown) =>
                  toast.error(error instanceof Error ? error.message : String(error)),
                );
              }}
            >
              {frontendMessage("mobile.backgroundSettings")}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {devicesOpen && httpBaseUrl ? (
        <Suspense fallback={null}>
          <LazyDeviceConnectionsDialog open={devicesOpen} onOpenChange={setDevicesOpen} httpBaseUrl={httpBaseUrl} />
        </Suspense>
      ) : null}
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
        uploadAvatar={
          httpBaseUrl
            ? async (file) => {
                return saveProfileAvatar(httpBaseUrl, "user", file, uploadCsrfToken);
              }
            : undefined
        }
      />
    </div>
  );
}

function UserAvatar({ profile, size = "normal" }: { profile: UserProfile; size?: "normal" | "hero" }): JSX.Element {
  return <ProfileIdentityAvatar identity={profile} kind="user" size={size} />;
}

function ProfileDialog({
  open,
  profile,
  returnFocus,
  onOpenChange,
  onSubmit,
  onLogout,
  uploadAvatar,
}: {
  open: boolean;
  profile: UserProfile;
  returnFocus: HTMLElement | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (profile: ConversationProfileUpdate) => void;
  onLogout?: () => Promise<void>;
  uploadAvatar?: (file: File) => Promise<string>;
}): JSX.Element {
  const [draftUser, setDraftUser] = useState<ConversationIdentity>(() => readProfileIdentity(profile));
  const [crop, setCrop] = useState<AvatarCropState | null>(null);
  const [saving, setSaving] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const avatarButtonRef = useRef<HTMLButtonElement>(null);
  const cropWasActiveRef = useRef(false);
  const cropImage = useLoadedAvatarImage(crop?.source ?? null);
  const activeIdentity = draftUser;
  const activeIdentityName = activeIdentity.name.trim();
  const namesMissing = draftUser.name.trim().length === 0;

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
    setDraftUser(readProfileIdentity(profile));
    setCrop(null);
    setSaving(false);
  };

  const updateActiveIdentity = (patch: Partial<ConversationIdentity>): void => {
    setDraftUser((current) => ({ ...current, ...patch }));
  };

  const readAvatarFile = (file: File): void => {
    void readAvatarCrop(file)
      .then(setCrop)
      .catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : frontendMessage("profile.avatarReadFailed"));
      });
  };

  const applyCrop = (): void => {
    if (!crop || !cropImage) return;
    try {
      const avatarDataUrl = renderAvatarCrop(cropImage, crop);
      setDraftUser((current) => ({ ...current, avatarDataUrl, avatarPath: null }));
      setCrop(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : frontendMessage("profile.imageLoadFailed"));
    }
  };

  const updateCrop = useCallback<Dispatch<SetStateAction<AvatarCropState | null>>>((update) => {
    setCrop((current) => {
      if (!current) return null;
      const next = typeof update === "function" ? update(current) : update;
      if (!next) return null;
      return next.source === current.source &&
        next.scale === current.scale &&
        next.offsetX === current.offsetX &&
        next.offsetY === current.offsetY
        ? current
        : next;
    });
  }, []);

  const submitProfile = async (): Promise<void> => {
    const user = normalizeProfileIdentity(draftUser);
    if (!user) {
      toast.error(frontendMessage("profile.nameRequired"));
      return;
    }

    setSaving(true);
    try {
      onSubmit(await persistAvatarResource(user, uploadAvatar));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : frontendMessage("upload.failed"));
    } finally {
      setSaving(false);
    }
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
        bodyClassName="min-h-0 flex-1 overflow-y-auto px-6 pb-6"
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
              <DialogActionButton
                type="submit"
                form="profile-editor-form"
                variant="primary"
                disabled={namesMissing || saving}
              >
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
            <AvatarCropper crop={crop} image={cropImage} onCropChange={updateCrop} />
          </form>
        ) : (
          <form
            id="profile-editor-form"
            className="grid gap-6"
            onSubmit={(event) => {
              event.preventDefault();
              void submitProfile();
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
                    <ProfileIdentityAvatar identity={activeIdentity} kind="user" size="hero" />
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
                    {activeIdentity.avatarDataUrl || activeIdentity.avatarPath ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => updateActiveIdentity({ avatarDataUrl: null, avatarPath: null })}
                      >
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
                {activeIdentity.name.length >= DISPLAY_NAME_COUNTER_THRESHOLD ? (
                  <span
                    className={cn(
                      "text-[11.5px] tabular-nums text-content-muted",
                      activeIdentity.name.length >= MAX_DISPLAY_NAME_LENGTH && "text-brick-600",
                    )}
                  >
                    {activeIdentity.name.length}/{MAX_DISPLAY_NAME_LENGTH}
                  </span>
                ) : null}
              </div>
              <Input
                ref={nameInputRef}
                aria-label={frontendMessage("profile.displayName")}
                aria-invalid={!activeIdentityName}
                aria-describedby={!activeIdentityName ? "profile-name-error" : undefined}
                value={activeIdentity.name}
                maxLength={MAX_DISPLAY_NAME_LENGTH}
                placeholder={frontendMessage("profile.namePlaceholder")}
                className="h-10 text-[13px]"
                onChange={(event) => updateActiveIdentity({ name: event.target.value })}
              />
              {!activeIdentityName ? (
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

function readProfileIdentity(profile: UserProfile): ConversationIdentity {
  return {
    name: profile.name,
    avatarDataUrl: profile.avatarDataUrl,
    avatarPath: profile.avatarPath,
  };
}

function normalizeProfileIdentity(identity: ConversationIdentity): ConversationIdentity | null {
  const name = identity.name.trim();
  return name ? { ...identity, name } : null;
}

async function persistAvatarResource(
  identity: ConversationIdentity,
  uploadAvatar: ((file: File) => Promise<string>) | undefined,
): Promise<ConversationIdentity> {
  if (!identity.avatarDataUrl?.startsWith("data:image/")) return identity;
  if (!uploadAvatar) return identity;
  const resourcePath = await uploadAvatar(dataUrlToFile(identity.avatarDataUrl, "profile-user"));
  return { ...identity, avatarDataUrl: null, avatarPath: resourcePath };
}

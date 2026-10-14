import { useEffect, useState, type ReactNode } from "react";
import type { ConfigMutationState } from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import {
  AppIcon,
  Button,
  Dialog,
  DialogActionButton,
  DialogActions,
  DialogContent,
  FormField,
  FormHint,
  FormLabel,
  IconButton,
  Spinner,
} from "../../shared/ui";

export function PersonaControl({
  open,
  onOpenChange,
  disabled,
  corePersona,
  languageStyle,
  operation,
  onSave,
  showTrigger = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled: boolean;
  corePersona: string;
  languageStyle: string;
  operation?: ConfigMutationState | null;
  onSave: (input: { corePersona: string; languageStyle: string }) => string | null;
  showTrigger?: boolean;
}): JSX.Element {
  const [draftCorePersona, setDraftCorePersona] = useState(corePersona);
  const [draftLanguageStyle, setDraftLanguageStyle] = useState(languageStyle);

  useEffect(() => {
    if (!open) return;
    setDraftCorePersona(corePersona);
    setDraftLanguageStyle(languageStyle);
  }, [corePersona, languageStyle, open]);

  const saving = operation?.status === "pending";
  const dirty = draftCorePersona !== corePersona || draftLanguageStyle !== languageStyle;
  const submit = (): void => {
    if (disabled || saving || !dirty) return;
    const requestId = onSave({
      corePersona: draftCorePersona.trim(),
      languageStyle: draftLanguageStyle.trim(),
    });
    if (requestId) onOpenChange(false);
  };

  return (
    <>
      {showTrigger ? (
        <IconButton
          label={frontendMessage("persona.ui.open")}
          tooltip={frontendMessage("persona.ui.open")}
          tone="muted"
          disabled={disabled}
          onClick={() => onOpenChange(true)}
        >
          <AppIcon icon="book-user" size={16} />
        </IconButton>
      ) : null}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          title={frontendMessage("persona.ui.title")}
          description={frontendMessage("persona.ui.description")}
          motionPreset="focus"
          className="w-[min(760px,calc(100vw-24px))]"
          bodyClassName="min-h-0 overflow-y-auto"
          footer={
            <DialogActions>
              <DialogActionButton onClick={() => onOpenChange(false)} disabled={saving}>
                {frontendMessage("ui.cancel")}
              </DialogActionButton>
              <Button onClick={submit} disabled={disabled || saving || !dirty}>
                {saving ? <Spinner size="sm" /> : <AppIcon icon="save" size={14} />}
                {frontendMessage("persona.ui.save")}
              </Button>
            </DialogActions>
          }
        >
          <div className="grid gap-px border-t border-line-subtle bg-line-subtle sm:grid-cols-2">
            <PersonaField
              icon="user"
              label={frontendMessage("persona.ui.corePersona")}
              description={frontendMessage("persona.ui.corePersonaDescription")}
            >
              <textarea
                value={draftCorePersona}
                onChange={(event) => setDraftCorePersona(event.currentTarget.value)}
                disabled={disabled || saving}
                rows={5}
                placeholder={frontendMessage("persona.ui.corePersonaPlaceholder")}
                className={textareaClass}
              />
            </PersonaField>
            <PersonaField
              icon="language"
              label={frontendMessage("persona.ui.languageStyle")}
              description={frontendMessage("persona.ui.languageStyleDescription")}
            >
              <textarea
                value={draftLanguageStyle}
                onChange={(event) => setDraftLanguageStyle(event.currentTarget.value)}
                disabled={disabled || saving}
                rows={4}
                placeholder={frontendMessage("persona.ui.languageStylePlaceholder")}
                className={textareaClass}
              />
            </PersonaField>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function PersonaField({
  icon,
  label,
  description,
  children,
}: {
  icon: "language" | "user";
  label: string;
  description: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="bg-surface-panel px-5 py-4 sm:px-6 sm:py-5">
      <FormField className="gap-1.5">
        <div className="flex items-center gap-1.5">
          <AppIcon icon={icon} size={14} className="text-accent-content" aria-hidden="true" />
          <FormLabel className="font-semibold">{label}</FormLabel>
        </div>
        <FormHint className="min-h-10">{description}</FormHint>
        {children}
      </FormField>
    </div>
  );
}

const textareaClass =
  "min-h-28 w-full resize-y rounded-md border border-line-subtle bg-surface-subtle px-3 py-2.5 text-[13px] leading-6 text-content-primary outline-none transition-[background-color,border-color,box-shadow] placeholder:text-content-muted hover:border-line-strong focus:border-accent-border focus:bg-surface-panel focus:ring-2 focus:ring-accent-focus disabled:cursor-not-allowed disabled:opacity-60";

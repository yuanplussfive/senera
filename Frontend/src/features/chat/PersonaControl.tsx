import { useEffect, useState } from "react";
import type { ConfigMutationState } from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import {
  AppIcon,
  Button,
  Dialog,
  DialogActionButton,
  DialogActions,
  DialogContent,
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
          className="w-[min(640px,calc(100vw-24px))]"
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
          <div className="flex flex-col gap-5 px-6 py-5">
            <label className="flex flex-col gap-2">
              <span className="text-[13px] font-semibold text-content-primary">
                {frontendMessage("persona.ui.corePersona")}
              </span>
              <span className="text-[12px] leading-5 text-content-muted">
                {frontendMessage("persona.ui.corePersonaDescription")}
              </span>
              <textarea
                value={draftCorePersona}
                onChange={(event) => setDraftCorePersona(event.currentTarget.value)}
                disabled={disabled || saving}
                rows={5}
                placeholder={frontendMessage("persona.ui.corePersonaPlaceholder")}
                className={textareaClass}
              />
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-[13px] font-semibold text-content-primary">
                {frontendMessage("persona.ui.languageStyle")}
              </span>
              <span className="text-[12px] leading-5 text-content-muted">
                {frontendMessage("persona.ui.languageStyleDescription")}
              </span>
              <textarea
                value={draftLanguageStyle}
                onChange={(event) => setDraftLanguageStyle(event.currentTarget.value)}
                disabled={disabled || saving}
                rows={4}
                placeholder={frontendMessage("persona.ui.languageStylePlaceholder")}
                className={textareaClass}
              />
            </label>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

const textareaClass =
  "min-h-24 w-full resize-y rounded-md border border-line bg-surface-panel px-3 py-2.5 text-[13px] leading-6 text-content-primary outline-none placeholder:text-content-muted focus:border-accent-border focus:ring-2 focus:ring-accent-focus disabled:cursor-not-allowed disabled:opacity-60";

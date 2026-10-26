import { useState } from "react";
import type { FeedbackCategory, FeedbackRating } from "../../api/feedbackEventTypes";
import { FeedbackCategories } from "../../api/feedbackEventTypes";
import { frontendFeatureMessage } from "../../i18n/frontendFeatureMessageCatalog";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { useStore } from "../../store/sessionStore";
import { AppIcon, Dialog, DialogActionButton, DialogActions, DialogContent, IconButton } from "../../shared/ui";

/**
 * The user's own rating of one finished turn.
 *
 * Rating opens the category dialog; clicking the rating that is already
 * recorded retracts it without a dialog. The control renders the durable
 * record, so a rejected request leaves the previous state in place.
 */
export function MessageFeedbackControl({
  sessionId,
  requestId,
  disabled = false,
  onRecord,
}: {
  sessionId: string;
  requestId: string;
  disabled?: boolean;
  onRecord: (sessionId: string, requestId: string, rating: FeedbackRating | null, category?: FeedbackCategory) => void;
}): JSX.Element {
  const record = useStore((s) => s.sessions[sessionId]?.messageFeedback?.[requestId]);
  const [draft, setDraft] = useState<{ rating: FeedbackRating; category: FeedbackCategory | null } | null>(null);

  const recorded = record?.rating ?? null;

  const selectRating = (rating: FeedbackRating): void => {
    if (recorded === rating) {
      onRecord(sessionId, requestId, null);
      return;
    }
    setDraft({ rating, category: null });
  };

  const submitDraft = (): void => {
    if (!draft) return;
    onRecord(sessionId, requestId, draft.rating, draft.category ?? undefined);
    setDraft(null);
  };

  return (
    <>
      <div className="flex shrink-0 items-center" data-message-feedback={recorded ?? "none"}>
        <IconButton
          label={frontendFeatureMessage("feedback.helpful")}
          tooltip={frontendFeatureMessage("feedback.helpful")}
          tooltipSide="bottom"
          size="sm"
          tone="muted"
          touchSafe
          disabled={disabled}
          onClick={() => selectRating("positive")}
          className={cn("h-6 w-6 rounded-md", recorded === "positive" && "text-moss-600")}
          data-message-feedback-action="positive"
        >
          <AppIcon icon="thumb-up" className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton
          label={frontendFeatureMessage("feedback.notHelpful")}
          tooltip={frontendFeatureMessage("feedback.notHelpful")}
          tooltipSide="bottom"
          size="sm"
          tone="muted"
          touchSafe
          disabled={disabled}
          onClick={() => selectRating("negative")}
          className={cn("h-6 w-6 rounded-md", recorded === "negative" && "text-brick-600")}
          data-message-feedback-action="negative"
        >
          <AppIcon icon="thumb-down" className="h-3.5 w-3.5" />
        </IconButton>
      </div>

      <Dialog
        open={draft !== null}
        onOpenChange={(open) => {
          if (!open) setDraft(null);
        }}
      >
        <DialogContent
          title={frontendFeatureMessage("feedback.dialog.title")}
          description={frontendFeatureMessage(
            draft?.rating === "negative"
              ? "feedback.dialog.descriptionNegative"
              : "feedback.dialog.descriptionPositive",
          )}
          className="w-[min(440px,calc(100vw-28px))]"
          bodyClassName="px-4 pb-4 pt-3"
          footerClassName="px-4"
          footer={
            <DialogActions>
              <DialogActionButton close>{frontendMessage("ui.cancel")}</DialogActionButton>
              <DialogActionButton onClick={submitDraft}>
                {frontendFeatureMessage("feedback.dialog.submit")}
              </DialogActionButton>
            </DialogActions>
          }
        >
          <div
            className="flex flex-wrap gap-1.5"
            role="group"
            aria-label={frontendFeatureMessage("feedback.dialog.categoryLabel")}
          >
            {FeedbackCategories.map((category) => {
              const active = draft?.category === category;
              return (
                <button
                  key={category}
                  type="button"
                  aria-pressed={active}
                  onClick={() =>
                    setDraft((current) => (current ? { ...current, category: active ? null : category } : current))
                  }
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus",
                    active
                      ? "border-accent-border-strong bg-accent-surface text-accent-content"
                      : "border-line text-content-secondary hover:bg-surface-hover hover:text-content-primary",
                  )}
                  data-feedback-category={category}
                >
                  {frontendFeatureMessage(`feedback.category.${category}`)}
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

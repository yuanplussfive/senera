import type { ComposerAttachmentDraft, PendingAttachment } from "./composerAttachmentDraft";

/** Capture the owner and File list together; restoring text or reconnecting cannot retarget a selection. */
export function enqueueComposerFileSelection(
  input: HTMLInputElement,
  owner: ComposerAttachmentDraft,
  mediaType?: PendingAttachment["mediaType"],
): Promise<void> {
  const selected = owner.enqueue(Array.from(input.files ?? []), mediaType);
  input.value = "";
  return selected;
}

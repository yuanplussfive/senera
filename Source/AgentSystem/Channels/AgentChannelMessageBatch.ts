import { errorMessage } from "../Core/AgentErrors.js";
import type { AgentChannelDeliveryReceipt } from "./AgentChannelDelivery.js";
import type { AgentChannelInboxReview, AgentChannelMessageBatchReceipt } from "./AgentChannelParticipation.js";

/** Send only the next item after a confirmed receipt and a fresh inbox review. */
export async function deliverAgentChannelMessageBatch(options: {
  readonly messages: readonly string[];
  readonly signal?: AbortSignal;
  readonly review: () => AgentChannelInboxReview | undefined;
  readonly deliver: (content: string, index: number) => Promise<AgentChannelDeliveryReceipt>;
  readonly record: (content: string, messageId: string, index: number) => void;
  readonly onError: (error: unknown) => void;
}): Promise<AgentChannelMessageBatchReceipt> {
  const messageIds: string[] = [];
  for (const [index, content] of options.messages.entries()) {
    if (options.signal?.aborted) {
      return { status: "failed", messageIds, code: "cancelled", error: "Message batch cancelled." };
    }
    let phase: "review_failed" | "delivery_failed" | "history_failed" = "review_failed";
    try {
      const review = options.review();
      if (review) return { ...review, messageIds };
      phase = "delivery_failed";
      const receipt = await options.deliver(content, index);
      if (receipt.status === "failed") {
        return { status: "failed", messageIds, code: receipt.code, error: errorMessage(receipt.error) };
      }
      // A later journal failure must not hide a message already accepted by the platform.
      messageIds.push(receipt.messageId);
      phase = "history_failed";
      options.record(content, receipt.messageId, index);
    } catch (error) {
      options.onError(error);
      return { status: "failed", messageIds, code: phase, error: errorMessage(error) };
    }
  }
  return { status: "sent", messageIds };
}

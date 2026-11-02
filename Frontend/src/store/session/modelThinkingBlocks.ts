import type { ModelThinkingBlock } from "./types";

export interface ModelThinkingBlockCoordinate {
  readonly step: number;
  readonly messageIndex: number;
  readonly contentIndex: number;
  readonly eventSequence: number;
}

/**
 * Model reasoning is an ordered stream, not a collection to be sorted by each
 * view. Keep that order at the projection boundary so every consumer can read
 * the same deterministic transcript directly.
 */
export function compareModelThinkingBlocks(left: ModelThinkingBlock, right: ModelThinkingBlock): number {
  return (
    left.step - right.step ||
    left.messageIndex - right.messageIndex ||
    left.contentIndex - right.contentIndex ||
    (left.eventSequence ?? Number.MAX_SAFE_INTEGER) - (right.eventSequence ?? Number.MAX_SAFE_INTEGER) ||
    left.id.localeCompare(right.id)
  );
}

export function readModelThinkingBlockId(
  coordinate: Pick<ModelThinkingBlockCoordinate, "step" | "messageIndex" | "contentIndex">,
): string {
  return `step:${coordinate.step}:message:${coordinate.messageIndex}:content:${coordinate.contentIndex}`;
}

export function findOrCreateModelThinkingBlock(
  blocks: ModelThinkingBlock[],
  coordinate: ModelThinkingBlockCoordinate,
): ModelThinkingBlock {
  const id = readModelThinkingBlockId(coordinate);
  const latest = blocks.at(-1);
  if (latest?.id === id) return latest;

  const existing = blocks.find((block) => block.id === id);
  if (existing) return existing;

  const block: ModelThinkingBlock = {
    id,
    step: coordinate.step,
    messageIndex: coordinate.messageIndex,
    contentIndex: coordinate.contentIndex,
    eventSequence: coordinate.eventSequence,
    content: "",
    status: "streaming",
  };
  const insertionIndex = findModelThinkingBlockInsertionIndex(blocks, block);
  blocks.splice(insertionIndex, 0, block);
  return block;
}

function findModelThinkingBlockInsertionIndex(
  blocks: readonly ModelThinkingBlock[],
  candidate: ModelThinkingBlock,
): number {
  let low = 0;
  let high = blocks.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (compareModelThinkingBlocks(blocks[middle]!, candidate) <= 0) low = middle + 1;
    else high = middle;
  }
  return low;
}

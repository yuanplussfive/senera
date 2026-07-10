import type { AgentLanguageModelRequest } from "./AgentLanguageModel.js";

export interface OpenAiCompatibleTextMessage {
  role: "system" | "developer" | "user" | "assistant";
  content: string;
}

export interface OpenAiCompatibleMessageProjectionOptions {
  developerRole: "native" | "system";
}

interface SystemInstructionBlock {
  kind: "system" | "developer";
  content: string;
}

export function projectOpenAiCompatibleTextMessages(
  request: AgentLanguageModelRequest,
  options: OpenAiCompatibleMessageProjectionOptions,
): OpenAiCompatibleTextMessage[] {
  const instructionBlocks: SystemInstructionBlock[] = [{
    kind: "system",
    content: request.systemPrompt,
  }];
  const conversation: OpenAiCompatibleTextMessage[] = [];

  for (const message of request.messages) {
    if (message.role === "system" || message.role === "developer") {
      instructionBlocks.push({
        kind: message.role,
        content: message.content,
      });
      continue;
    }
    conversation.push({
      role: message.role,
      content: message.content,
    });
  }

  return [
    ...projectInstructionBlocks(instructionBlocks, options),
    ...conversation,
  ];
}

function projectInstructionBlocks(
  blocks: readonly SystemInstructionBlock[],
  options: OpenAiCompatibleMessageProjectionOptions,
): OpenAiCompatibleTextMessage[] {
  if (options.developerRole === "native") {
    return blocks.flatMap((block) =>
      block.content.trim().length > 0
        ? [{
            role: block.kind,
            content: block.content,
          }]
        : []);
  }

  const content = blocks
    .filter((block) => block.content.trim().length > 0)
    .map(renderSystemCompatibleInstructionBlock)
    .join("\n\n");
  return content
    ? [{
        role: "system",
        content,
      }]
    : [];
}

function renderSystemCompatibleInstructionBlock(block: SystemInstructionBlock): string {
  const tag = block.kind === "developer" ? "developer_instructions" : "system_instructions";
  return [
    `<${tag}>`,
    block.content,
    `</${tag}>`,
  ].join("\n");
}

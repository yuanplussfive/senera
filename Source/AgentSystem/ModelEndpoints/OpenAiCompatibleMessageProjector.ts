import type { AgentLanguageModelImageAttachment, AgentLanguageModelRequest } from "./AgentLanguageModel.js";

export interface OpenAiCompatibleMessage {
  role: "system" | "developer" | "user" | "assistant";
  content: string | OpenAiCompatibleContentPart[];
}

export type OpenAiCompatibleContentPart =
  { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export interface OpenAiCompatibleMessageProjectionOptions {
  developerRole: "native" | "system";
}

interface SystemInstructionBlock {
  kind: "system" | "developer";
  content: string;
  attachments?: readonly AgentLanguageModelImageAttachment[];
}

export function projectOpenAiCompatibleMessages(
  request: AgentLanguageModelRequest,
  options: OpenAiCompatibleMessageProjectionOptions,
): OpenAiCompatibleMessage[] {
  const instructionBlocks: SystemInstructionBlock[] = [
    {
      kind: "system",
      content: request.systemPrompt,
    },
  ];
  const conversation: OpenAiCompatibleMessage[] = [];

  for (const message of request.messages) {
    if (message.role === "system" || message.role === "developer") {
      instructionBlocks.push({
        kind: message.role,
        content: message.content,
        attachments: message.attachments,
      });
      continue;
    }
    conversation.push({
      role: message.role,
      content: projectOpenAiCompatibleContent(message.content, message.attachments),
    });
  }

  return [...projectInstructionBlocks(instructionBlocks, options), ...conversation];
}

function projectInstructionBlocks(
  blocks: readonly SystemInstructionBlock[],
  options: OpenAiCompatibleMessageProjectionOptions,
): OpenAiCompatibleMessage[] {
  if (options.developerRole === "native") {
    return blocks.flatMap((block) =>
      block.content.trim().length > 0
        ? [
            {
              role: block.kind,
              content: projectOpenAiCompatibleContent(block.content, block.attachments),
            },
          ]
        : [],
    );
  }

  const content = blocks
    .filter((block) => block.content.trim().length > 0)
    .map(renderSystemCompatibleInstructionBlock)
    .join("\n\n");
  return content
    ? [
        {
          role: "system",
          content,
        },
      ]
    : [];
}

export function projectOpenAiCompatibleTextMessages(
  request: AgentLanguageModelRequest,
  options: OpenAiCompatibleMessageProjectionOptions,
): OpenAiCompatibleMessage[] {
  return projectOpenAiCompatibleMessages(request, options);
}

function projectOpenAiCompatibleContent(
  text: string,
  attachments: readonly AgentLanguageModelImageAttachment[] | undefined,
): string | OpenAiCompatibleContentPart[] {
  if (!attachments?.length) return text;
  return [
    ...(text ? [{ type: "text" as const, text }] : []),
    ...attachments.map((attachment) => ({
      type: "image_url" as const,
      image_url: { url: `data:${attachment.mimeType};base64,${attachment.data}` },
    })),
  ];
}

function renderSystemCompatibleInstructionBlock(block: SystemInstructionBlock): string {
  const tag = block.kind === "developer" ? "developer_instructions" : "system_instructions";
  return [`<${tag}>`, block.content, `</${tag}>`].join("\n");
}

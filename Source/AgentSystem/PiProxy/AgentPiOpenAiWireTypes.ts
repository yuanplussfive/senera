import { z } from "zod";

const TextPartSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
}).passthrough();

const ImagePartSchema = z.object({
  type: z.string(),
}).passthrough();

export const PiOpenAiMessageSchema = z.object({
  role: z.enum(["system", "developer", "user", "assistant", "tool"]),
  content: z.union([
    z.string(),
    z.array(z.union([TextPartSchema, ImagePartSchema])),
    z.null(),
  ]).optional(),
  name: z.string().optional(),
  tool_call_id: z.string().optional(),
  tool_calls: z.array(z.object({
    id: z.string().optional(),
    type: z.literal("function").optional(),
    function: z.object({
      name: z.string(),
      arguments: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
    }).passthrough(),
  }).passthrough()).optional(),
}).passthrough();

export const PiOpenAiToolSchema = z.object({
  type: z.literal("function"),
  function: z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    parameters: z.record(z.string(), z.unknown()).optional(),
  }).passthrough(),
}).passthrough();

export const PiOpenAiChatCompletionRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(PiOpenAiMessageSchema),
  tools: z.array(PiOpenAiToolSchema).optional(),
  tool_choice: z.unknown().optional(),
  temperature: z.number().optional(),
  max_tokens: z.number().optional(),
  max_completion_tokens: z.number().optional(),
  parallel_tool_calls: z.boolean().optional(),
  stream: z.boolean().optional(),
}).passthrough();

export type PiOpenAiMessage = z.infer<typeof PiOpenAiMessageSchema>;
export type PiOpenAiTool = z.infer<typeof PiOpenAiToolSchema>;
export type PiOpenAiChatCompletionRequest = z.infer<typeof PiOpenAiChatCompletionRequestSchema>;

export interface PiOpenAiToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface PiOpenAiChatCompletionChoiceMessage {
  role: "assistant";
  content: string | null;
  tool_calls?: PiOpenAiToolCall[];
}

export interface PiOpenAiChatCompletionChoice {
  index: number;
  message: PiOpenAiChatCompletionChoiceMessage;
  finish_reason: "stop" | "tool_calls";
}

export interface PiOpenAiChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: PiOpenAiChatCompletionChoice[];
}

export interface PiOpenAiModelsResponse {
  object: "list";
  data: Array<{
    id: string;
    object: "model";
    created: number;
    owned_by: string;
  }>;
}

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import generateImage from "./lib/generate.mjs";

const server = new McpServer({ name: "imagen", version: "1.0.0" });

server.registerTool(
  "ImageGenerate",
  {
    title: "Generate Image",
    description:
      "Generate one or more images from a prompt. Use n for multiple variants of the same prompt; use separate calls in one turn only when prompts differ. Independent calls may run concurrently. The configured request mode selects the OpenAI-compatible endpoint; model and image options may be supplied when needed.",
    inputSchema: {
      prompt: z.string().trim().min(1).max(32_000).describe("The visual description or image-generation instruction."),
      model: z.string().trim().min(1).optional().describe("Image model. Defaults to gpt-image-2."),
      mode: z
        .enum(["images", "chat"])
        .optional()
        .describe("Optional per-call override for the configured request mode."),
      size: z
        .string()
        .trim()
        .min(1)
        .default("1536x1024")
        .describe("Output size such as 1536x1024, 1024x1024, or auto."),
      quality: z.enum(["auto", "low", "medium", "high"]).optional(),
      n: z.number().int().min(1).max(10).optional().describe("Number of images to generate when supported."),
      outputFormat: z.enum(["png", "jpeg", "webp"]).optional(),
      outputCompression: z.number().int().min(0).max(100).optional(),
      background: z.enum(["auto", "opaque", "transparent"]).optional(),
      moderation: z.enum(["auto", "low"]).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    _meta: {
      "ai.senera/runtime": {
        scheduling: "parallel",
        maxConcurrency: 3,
      },
    },
  },
  async (input, extra) => {
    const execution = await generateImage(input, {
      environment: process.env,
      signal: extra.signal,
    });
    const content = [
      { type: "text", text: execution.data.markdown || execution.data.text },
      ...(execution.artifactPayload.assets ?? []).map((asset) => ({
        type: "image",
        data: asset.dataBase64,
        mimeType: asset.mediaType,
      })),
    ];
    return {
      content,
    };
  },
);

await server.connect(new StdioServerTransport());

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import search from "./lib/search.mjs";

const server = new McpServer({ name: "web-research", version: "1.0.0" });
const switchValue = z.union([z.boolean(), z.enum(["basic", "advanced"])]);
const contentValue = z.union([z.boolean(), z.enum(["markdown", "text"])]);
const searchOutput = z
  .object({
    query: z.string(),
    answer: z.string().optional(),
    results: z.array(
      z
        .object({
          title: z.string(),
          url: z.string(),
          content: z.string(),
          score: z.number().optional(),
          publishedDate: z.string().optional(),
          rawContent: z.string().optional(),
          favicon: z.string().optional(),
        })
        .strict(),
    ),
    images: z.array(z.object({ url: z.string(), description: z.string().optional() }).strict()),
    responseTime: z.number().optional(),
    requestId: z.string().optional(),
    usage: z.object({ credits: z.number() }).strict().optional(),
    source: z.literal("Tavily"),
  })
  .strict();

server.registerTool(
  "search",
  {
    title: "Web Search",
    description: "Search current public web information and return source-backed results.",
    inputSchema: {
      query: z.string().trim().min(1).describe("Concrete question or search query."),
      searchDepth: z.enum(["basic", "advanced", "fast", "ultra-fast"]).optional(),
      topic: z.enum(["general", "news", "finance"]).optional(),
      maxResults: z.number().int().min(1).max(20).optional(),
      includeAnswer: switchValue.optional(),
      includeRawContent: contentValue.optional(),
      includeImages: z.boolean().optional(),
      includeImageDescriptions: z.boolean().optional(),
      includeFavicon: z.boolean().optional(),
      includeDomains: z.array(z.string().trim().min(1)).optional(),
      excludeDomains: z.array(z.string().trim().min(1)).optional(),
      timeRange: z.enum(["day", "week", "month", "year", "d", "w", "m", "y"]).optional(),
      days: z.number().int().min(1).optional(),
      startDate: z.string().date().optional(),
      endDate: z.string().date().optional(),
      chunksPerSource: z.number().int().min(1).max(3).optional(),
      country: z.string().trim().min(1).optional(),
      autoParameters: z.boolean().optional(),
      exactMatch: z.boolean().optional(),
      includeUsage: z.boolean().optional(),
      safeSearch: z.boolean().optional(),
    },
    outputSchema: searchOutput,
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async (input, extra) => {
    const result = await search(input, { environment: process.env, signal: extra.signal });
    return {
      content: [{ type: "text", text: result.summary }],
      structuredContent: result.data,
    };
  },
);

await server.connect(new StdioServerTransport());

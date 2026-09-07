import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import forecast from "./lib/forecast.mjs";

const forecastOutput = z
  .object({
    location: z.string(),
    resolvedLocation: z.string(),
    country: z.string().optional(),
    region: z.string().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    timezone: z.string().optional(),
    observationTime: z.string().optional(),
    temperature: z.number().optional(),
    feelsLike: z.number().optional(),
    temperatureUnit: z.enum(["celsius", "fahrenheit"]),
    condition: z.string(),
    humidity: z.number().optional(),
    windSpeed: z.number().optional(),
    windSpeedUnit: z.string().optional(),
    windDirection: z.string().optional(),
    forecast: z.array(
      z
        .object({
          date: z.string(),
          condition: z.string(),
          maxTemperature: z.number().optional(),
          minTemperature: z.number().optional(),
          temperatureUnit: z.enum(["celsius", "fahrenheit"]),
          chanceOfRain: z.number().optional(),
          precipitation: z.number().optional(),
          precipitationUnit: z.string().optional(),
          sunrise: z.string().optional(),
          sunset: z.string().optional(),
        })
        .strict(),
    ),
    source: z.literal("QWeather"),
  })
  .strict();

const server = new McpServer({ name: "weather", version: "1.0.0" });

server.registerTool(
  "forecast",
  {
    title: "Weather Forecast",
    description: "Query current conditions and up to 30 forecast days for a location.",
    inputSchema: {
      location: z.string().trim().min(1).describe("City, region, address, postal code, or coordinates."),
      days: z.number().int().min(1).max(30).optional(),
      language: z.string().trim().min(1).optional(),
    },
    outputSchema: forecastOutput,
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async (input, extra) => {
    const result = await forecast(input, { environment: process.env, signal: extra.signal });
    return {
      content: [{ type: "text", text: result.summary }],
      structuredContent: result.data,
    };
  },
);

await server.connect(new StdioServerTransport());

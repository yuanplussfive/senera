const DefaultModel = "gpt-image-2";
import { createResourceUri } from "./resource-uri.mjs";

const DefaultSize = "1536x1024";
const DefaultBaseUrl = "https://api.openai.com/v1";
const ArtifactMetaKey = "ai.senera/artifact";

const RequestRoutes = Object.freeze({
  images: "images/generations",
  chat: "chat/completions",
});

const ImageFormats = Object.freeze({ png: "png", jpeg: "jpeg", webp: "webp" });

export default async function generateImage(input, context) {
  const configuration = readConfiguration(context.environment);
  const request = normalizeRequest(input, configuration);
  const rawResponse =
    request.mode === "chat"
      ? await requestChatCompletions(request, configuration, context.signal)
      : await requestImageGenerations(request, configuration, context.signal);
  const projection =
    request.mode === "chat" ? projectChatResponse(rawResponse, request) : projectImageResponse(rawResponse, request);

  return {
    data: projection.data,
    artifactPayload: {
      rawResponse,
      assets: projection.assets,
    },
    artifactMetaKey: ArtifactMetaKey,
  };
}

async function requestImageGenerations(request, configuration, signal) {
  const body = compact({
    model: request.model,
    prompt: request.prompt,
    size: request.size,
    quality: request.quality,
    n: request.n,
    output_format: request.outputFormat,
    output_compression: request.outputCompression,
    background: request.background,
    moderation: request.moderation,
  });
  return requestJson(configuration, RequestRoutes.images, body, signal);
}

async function requestChatCompletions(request, configuration, signal) {
  const prompt = createChatPrompt(request);
  return requestJson(
    configuration,
    RequestRoutes.chat,
    {
      model: request.model,
      messages: [{ role: "user", content: prompt }],
      stream: false,
    },
    signal,
  );
}

async function requestJson(configuration, route, body, signal) {
  const endpoint = new URL(route, configuration.baseUrl).toString();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${configuration.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });
  const responseText = await response.text();
  const parsed = parseJson(responseText);
  if (!response.ok) {
    const providerMessage = readProviderError(parsed) ?? responseText.trim();
    const requestId = response.headers.get("x-request-id");
    throw new Error(
      `Imagen request failed with HTTP ${response.status}: ${truncate(providerMessage, 2_000)}${
        requestId ? ` (request id: ${requestId})` : ""
      }`,
    );
  }
  if (parsed === undefined) throw new Error("Imagen endpoint returned an empty response.");
  return parsed;
}

function normalizeRequest(input, configuration) {
  const prompt = requiredText(input.prompt, "prompt");
  const mode = input.mode ?? configuration.requestMode;
  if (!Object.hasOwn(RequestRoutes, mode)) throw new Error(`Unsupported Imagen request mode: ${mode}.`);
  const model = text(input.model) ?? DefaultModel;
  const size = normalizeSize(text(input.size) ?? DefaultSize);
  const outputFormat = text(input.outputFormat);
  if (outputFormat && !Object.hasOwn(ImageFormats, outputFormat)) {
    throw new Error(`Unsupported Imagen output format: ${outputFormat}.`);
  }
  if (input.outputCompression !== undefined && outputFormat === "png") {
    throw new Error("outputCompression is only supported with jpeg or webp output.");
  }
  if (input.background === "transparent" && model === DefaultModel) {
    throw new Error("gpt-image-2 does not support a transparent background.");
  }
  return compact({
    prompt,
    mode,
    model,
    size,
    quality: input.quality,
    n: input.n,
    outputFormat,
    outputCompression: input.outputCompression,
    background: input.background,
    moderation: input.moderation,
  });
}

function readConfiguration(environment) {
  const apiKey = text(environment.IMAGEN_API_KEY);
  if (!apiKey) throw new Error("Imagen requires IMAGEN_API_KEY.");
  return {
    apiKey,
    baseUrl: readBaseUrl(environment.IMAGEN_API_URL ?? DefaultBaseUrl),
    requestMode: readRequestMode(environment.IMAGEN_REQUEST_MODE),
  };
}

function readBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("IMAGEN_API_URL must be a valid http or https URL containing /v1.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("IMAGEN_API_URL must use http or https.");
  }
  const pathname = url.pathname.replace(/\/+$/u, "");
  if (!/(^|\/)v1$/u.test(pathname)) throw new Error("IMAGEN_API_URL must include the /v1 path.");
  url.pathname = `${pathname}/`;
  url.search = "";
  url.hash = "";
  return url;
}

function readRequestMode(value) {
  return value === "chat" ? "chat" : "images";
}

function createChatPrompt(request) {
  const settings = compact({
    size: request.size,
    quality: request.quality,
    count: request.n,
    format: request.outputFormat,
    background: request.background,
    moderation: request.moderation,
  });
  const settingsText = Object.entries(settings)
    .map(([name, value]) => `${name}: ${value}`)
    .join("\n");
  return settingsText ? `${request.prompt}\n\nImage settings:\n${settingsText}` : request.prompt;
}

function projectImageResponse(response, request) {
  const candidates = Array.isArray(response?.data) ? response.data : [];
  const assets = [];
  const images = candidates.flatMap((candidate, index) => {
    const image = projectImageCandidate(candidate, index, request, assets);
    return image ? [image] : [];
  });
  const revisedPrompt = firstText(candidates.map((candidate) => candidate?.revised_prompt));
  const text = revisedPrompt ? `Image generated. Revised prompt: ${revisedPrompt}` : "Image generated.";
  return {
    data: projectData(request, text, images, revisedPrompt),
    assets,
  };
}

function projectChatResponse(response, request) {
  const message = response?.choices?.[0]?.message;
  const text = readChatText(message, response) ?? "Image generation completed.";
  const assets = [];
  const candidates = collectChatImageCandidates(message, response, text);
  const images = candidates.flatMap((candidate, index) => {
    const image = projectImageCandidate(candidate, index, request, assets);
    return image ? [image] : [];
  });
  const markdown = ensureMarkdownImages(text, images);
  return {
    data: projectData(request, text, images, undefined, markdown),
    assets,
  };
}

function projectData(request, text, images, revisedPrompt, markdown = undefined) {
  return compact({
    mode: request.mode,
    model: request.model,
    size: request.size,
    text,
    markdown: markdown ?? ensureMarkdownImages(text, images),
    images,
    revisedPrompt,
  });
}

function projectImageCandidate(candidate, index, request, assets) {
  const url = text(candidate?.url) ?? text(candidate?.image_url?.url);
  const base64 = text(candidate?.b64_json) ?? readDataUrl(url)?.dataBase64;
  const mediaType =
    text(candidate?.mime_type) ??
    text(candidate?.mimeType) ??
    readDataUrl(url)?.mediaType ??
    formatMime(request.outputFormat);
  if (!url && !base64) return undefined;
  const id = `imagen-${index + 1}`;
  const sourceUrl = base64 ? createResourceUri(id) : url;
  if (base64) {
    assets.push({
      id,
      fileName: `${id}.${formatExtension(mediaType)}`,
      mediaType,
      dataBase64: base64,
    });
  }
  return {
    index,
    alt: `Generated image ${index + 1}`,
    markdown: `![Generated image ${index + 1}](${sourceUrl})`,
    source: base64 ? "artifact" : "url",
    ...(mediaType ? { mediaType } : {}),
  };
}

function collectChatImageCandidates(message, response, text) {
  const candidates = [];
  const content = Array.isArray(message?.content) ? message.content : [];
  for (const part of content) {
    const value = part?.image_url?.url ?? part?.url;
    if (value) candidates.push({ url: value });
  }
  for (const source of [message?.images, response?.images, response?.data]) {
    if (Array.isArray(source)) candidates.push(...source);
  }
  const markdownUrlPattern = /!\[[^\]]*\]\(([^)]+)\)/gu;
  for (const match of text.matchAll(markdownUrlPattern)) {
    if (match[1]) candidates.push({ url: match[1] });
  }
  return deduplicateCandidates(candidates);
}

function readChatText(message, response) {
  if (typeof message?.content === "string") return message.content.trim();
  if (Array.isArray(message?.content)) {
    const textParts = message.content.map((part) => (typeof part?.text === "string" ? part.text : "")).filter(Boolean);
    if (textParts.length > 0) return textParts.join("\n").trim();
  }
  return firstText([response?.output_text, response?.text]);
}

function ensureMarkdownImages(text, images) {
  const existing = new Set();
  for (const match of text.matchAll(/!\[[^\]]*\]\(([^)]+)\)/gu)) {
    if (match[1]) existing.add(match[1]);
  }
  const additions = images
    .filter((image) => !existing.has(readMarkdownUrl(image.markdown)))
    .map((image) => image.markdown);
  return [text, ...additions].filter(Boolean).join("\n\n").trim();
}

function deduplicateCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = candidate?.url ?? candidate?.b64_json;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeSize(value) {
  if (value === "auto") return value;
  const match = /^(\d+)x(\d+)$/u.exec(value);
  if (!match) throw new Error(`Invalid image size: ${value}. Use WIDTHxHEIGHT or auto.`);
  const width = Number(match[1]);
  const height = Number(match[2]);
  const pixels = width * height;
  const ratio = Math.max(width, height) / Math.min(width, height);
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width % 16 !== 0 ||
    height % 16 !== 0 ||
    width > 3_840 ||
    height > 3_840 ||
    pixels < 655_360 ||
    pixels > 8_294_400 ||
    ratio > 3
  ) {
    throw new Error(`Image size ${value} is outside the supported gpt-image-2 limits.`);
  }
  return value;
}

function readDataUrl(value) {
  if (typeof value !== "string") return undefined;
  const match = /^data:([^;,]+);base64,(.+)$/u.exec(value);
  return match ? { mediaType: match[1], dataBase64: match[2] } : undefined;
}

function readProviderError(value) {
  const error = value?.error;
  if (typeof error === "string") return error;
  if (error && typeof error.message === "string") return error.message;
  return undefined;
}

function parseJson(value) {
  if (!value.trim()) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function requiredText(value, name) {
  const result = text(value);
  if (!result) throw new Error(`Imagen ${name} is required.`);
  return result;
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function firstText(values) {
  return values.find((value) => text(value));
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function formatMime(format) {
  return format === "jpeg" ? "image/jpeg" : format === "webp" ? "image/webp" : "image/png";
}

function formatExtension(mime) {
  return mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png";
}

function readMarkdownUrl(markdown) {
  return /\]\(([^)]+)\)$/u.exec(markdown)?.[1];
}

function truncate(value, maxLength) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

export { ArtifactMetaKey, DefaultModel, DefaultSize, RequestRoutes };

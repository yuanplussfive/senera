const errorResponsePreviewCharacters = 1_000;
let credentialCursor = 0;

export default async function execute(input, context) {
  const credentials = environmentList(context.environment.TAVILY_API_KEYS, context.environment.TAVILY_API_KEY);
  if (credentials.length === 0) throw new Error("Web search requires TAVILY_API_KEY or TAVILY_API_KEYS.");
  const endpoint = httpsEndpoint(context.environment.TAVILY_BASE_URL ?? "https://api.tavily.com");
  const timeoutMs = positiveInteger(context.environment.TAVILY_TIMEOUT_MS);
  const response = await requestJson(
    new URL("/search", endpoint),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${nextCredential(credentials)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestPayload(input)),
    },
    context.signal,
    timeoutMs,
  );
  const data = responseProjection(response, input.query);
  return {
    data,
    summary: `${data.results.length} web result${data.results.length === 1 ? "" : "s"} for ${data.query}.`,
  };
}

function requestPayload(input) {
  return compact({
    query: input.query,
    search_depth: input.searchDepth ?? "basic",
    topic: input.topic ?? "general",
    max_results: input.maxResults ?? 5,
    include_answer: input.includeAnswer ?? false,
    include_raw_content: input.includeRawContent ?? false,
    include_images: input.includeImages ?? false,
    include_image_descriptions: input.includeImageDescriptions ?? false,
    include_favicon: input.includeFavicon ?? false,
    include_domains: input.includeDomains,
    exclude_domains: input.excludeDomains,
    time_range: input.timeRange,
    days: input.days,
    start_date: input.startDate,
    end_date: input.endDate,
    chunks_per_source: input.chunksPerSource,
    country: input.country,
    auto_parameters: input.autoParameters ?? false,
    exact_match: input.exactMatch ?? false,
    include_usage: input.includeUsage ?? true,
    safe_search: input.safeSearch ?? false,
  });
}

function responseProjection(value, fallbackQuery) {
  const response = record(value);
  return compact({
    query: text(response.query) ?? fallbackQuery,
    answer: text(response.answer),
    results: array(response.results).map((item) => {
      const result = record(item);
      return compact({
        title: text(result.title) ?? "Untitled result",
        url: text(result.url) ?? "",
        content: text(result.content) ?? "",
        score: number(result.score),
        publishedDate: text(result.published_date),
        rawContent: text(result.raw_content),
        favicon: text(result.favicon),
      });
    }),
    images: normalizeImages(response.images),
    responseTime: number(response.response_time),
    requestId: text(response.request_id),
    usage: normalizeUsage(response.usage),
    source: "Tavily",
  });
}

function normalizeImages(value) {
  return array(value).flatMap((item) => {
    if (typeof item === "string") return [{ url: item }];
    const image = record(item);
    const url = text(image.url);
    return url ? [compact({ url, description: text(image.description) })] : [];
  });
}

function normalizeUsage(value) {
  const credits = number(record(value).credits);
  return credits === undefined ? undefined : { credits };
}

async function requestJson(url, init, externalSignal, timeoutMs) {
  const signal = upstreamSignal(externalSignal, timeoutMs);
  const response = await fetch(url, { ...init, signal });
  const body = await response.text();
  if (!response.ok)
    throw new Error(
      `Tavily request failed with HTTP ${response.status}: ${body.slice(0, errorResponsePreviewCharacters)}`,
    );
  return body ? JSON.parse(body) : {};
}

function upstreamSignal(externalSignal, timeoutMs) {
  if (timeoutMs === undefined) return externalSignal;
  const timeout = AbortSignal.timeout(timeoutMs);
  return externalSignal ? AbortSignal.any([externalSignal, timeout]) : timeout;
}

function nextCredential(credentials) {
  const credential = credentials[credentialCursor % credentials.length];
  credentialCursor = (credentialCursor + 1) % credentials.length;
  return credential;
}

function environmentList(...values) {
  return [
    ...new Set(
      values
        .flatMap((value) => (typeof value === "string" ? value.split(",") : []))
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}

function httpsEndpoint(value) {
  const endpoint = new URL(value);
  if (endpoint.protocol !== "https:") throw new Error("Tavily endpoint must use HTTPS.");
  return endpoint;
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function number(value) {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

import type { ModelHttpPathSegment, ModelProviderConfig } from "./ModelEndpointTypes.js";

export function rawPathSegment(value: string): ModelHttpPathSegment {
  return { value, encode: "path" };
}

export function createModelHttpUrl(
  config: ModelProviderConfig,
  path: readonly ModelHttpPathSegment[],
  query?: Record<string, string>,
): URL {
  const url = new URL(withTrailingSlash(config.BaseUrl));
  const baseSegments = url.pathname.split("/").filter(Boolean);
  url.pathname = [...baseSegments, ...path.map(formatPathSegment)].join("/");
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value);
  }
  return url;
}

function withTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function formatPathSegment(segment: ModelHttpPathSegment): string {
  if (typeof segment === "string") {
    return encodeURIComponent(segment);
  }

  return segment.encode === "path"
    ? encodeURI(segment.value)
    : encodeURIComponent(segment.value);
}

const RedirectStatuses = new Set([301, 302, 303, 307, 308]);
const RequestBodyHeaders = [
  "content-encoding",
  "content-language",
  "content-location",
  "content-type",
  "content-length",
];

export function isAgentWebRedirect(status: number): boolean {
  return RedirectStatuses.has(status);
}

/** Explicit headers belong to their origin, including provider-specific credentials. */
export function projectAgentWebRedirectHeaders(
  headers: Readonly<Record<string, string>> | undefined,
  source: URL,
  target: URL,
  dropBody = false,
): Readonly<Record<string, string>> | undefined {
  if (source.origin !== target.origin) return undefined;
  if (!headers || !dropBody) return headers;
  const projected = new Headers(headers);
  for (const name of RequestBodyHeaders) projected.delete(name);
  return Object.fromEntries(projected);
}

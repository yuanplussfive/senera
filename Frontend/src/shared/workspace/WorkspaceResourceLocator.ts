export interface WorkspaceResourceLocator {
  readonly path: string;
  readonly line?: number;
  readonly column?: number;
}

const ExternalProtocolPattern = /^(?:https?|mailto|tel|data|blob|senera):/iu;
const UriSchemePattern = /^[a-z][a-z0-9+.-]*:/iu;
const WindowsAbsolutePathPattern = /^[a-z]:[\\/]/iu;
const ProtocolRelativeUrlPattern = /^\/\/[^/]/u;
const FileExtensionPattern = /(?:^|[\\/])[^\\/]+\.[a-z0-9][a-z0-9._-]*$/iu;

export function parseWorkspaceResourceLocator(value: string | undefined): WorkspaceResourceLocator | undefined {
  const source = decodeLocator(value?.trim());
  if (!source || source.startsWith("#") || ExternalProtocolPattern.test(source)) return undefined;

  const fileUri = parseFileUri(source);
  if (fileUri) return withSourcePosition(fileUri.path, fileUri.fragment);
  if (
    ProtocolRelativeUrlPattern.test(source) ||
    (UriSchemePattern.test(source) && !WindowsAbsolutePathPattern.test(source))
  ) {
    return undefined;
  }

  const [withoutFragment, fragment] = splitFragment(source);
  const pathWithPosition = stripQuery(withoutFragment);
  if (!isWorkspacePathCandidate(pathWithPosition)) return undefined;
  return withSourcePosition(pathWithPosition, fragment);
}

export function formatWorkspaceResourceLocation(locator: WorkspaceResourceLocator): string {
  if (!locator.line) return locator.path;
  return `${locator.path}:${locator.line}${locator.column ? `:${locator.column}` : ""}`;
}

function parseFileUri(value: string): { path: string; fragment?: string } | undefined {
  if (!/^file:/iu.test(value)) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.username || url.password || url.port || url.search) return undefined;

  let pathname = decodeLocator(url.pathname) ?? url.pathname;
  if (/^\/[a-z]:\//iu.test(pathname)) pathname = pathname.slice(1);
  if (url.hostname && url.hostname !== "localhost") pathname = `//${url.hostname}${pathname}`;
  return pathname ? { path: pathname, fragment: url.hash.slice(1) || undefined } : undefined;
}

function withSourcePosition(pathValue: string, fragment?: string): WorkspaceResourceLocator | undefined {
  const fromFragment = parseSourceFragment(fragment);
  const fromSuffix = fromFragment ? undefined : parseSourceSuffix(pathValue);
  const resourcePath = normalizePath((fromSuffix?.path ?? pathValue).trim());
  if (!resourcePath) return undefined;
  return {
    path: resourcePath,
    ...((fromFragment?.line ?? fromSuffix?.line) ? { line: fromFragment?.line ?? fromSuffix?.line } : {}),
    ...((fromFragment?.column ?? fromSuffix?.column) ? { column: fromFragment?.column ?? fromSuffix?.column } : {}),
  };
}

function parseSourceFragment(fragment: string | undefined): { line: number; column?: number } | undefined {
  if (!fragment) return undefined;
  const match = /^(?:L|line-?)(\d+)(?:C|:)(\d+)?(?:-L?\d+)?$/iu.exec(fragment);
  if (match?.[1]) {
    return {
      line: Number(match[1]),
      ...(match[2] ? { column: Number(match[2]) } : {}),
    };
  }
  const lineOnly = /^(?:L|line-?)(\d+)(?:-L?\d+)?$/iu.exec(fragment);
  return lineOnly?.[1] ? { line: Number(lineOnly[1]) } : undefined;
}

function parseSourceSuffix(value: string): { path: string; line: number; column?: number } | undefined {
  const match = /^(.*?):(\d+)(?::(\d+))?$/u.exec(value);
  if (!match?.[1] || !match[2]) return undefined;
  return {
    path: match[1],
    line: Number(match[2]),
    ...(match[3] ? { column: Number(match[3]) } : {}),
  };
}

function isWorkspacePathCandidate(value: string): boolean {
  return (
    WindowsAbsolutePathPattern.test(value) ||
    value.startsWith("/") ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.includes("\\") ||
    value.includes("/") ||
    FileExtensionPattern.test(value)
  );
}

function splitFragment(value: string): [string, string | undefined] {
  const index = value.indexOf("#");
  return index < 0 ? [value, undefined] : [value.slice(0, index), value.slice(index + 1) || undefined];
}

function stripQuery(value: string): string {
  const index = value.indexOf("?");
  return index < 0 ? value : value.slice(0, index);
}

function normalizePath(value: string): string {
  const portable = value.replace(/\\/gu, "/");
  return /^\/[a-z]:\//iu.test(portable) ? portable.slice(1) : portable;
}

function decodeLocator(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

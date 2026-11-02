export function parentWorkspacePath(value: string): string {
  const normalized = value.replace(/\\/gu, "/");
  const index = normalized.lastIndexOf("/");
  return index < 0 ? "." : normalized.slice(0, index) || ".";
}

export function joinWorkspacePath(parent: string, child: string): string {
  return parent === "." ? child : `${parent}/${child}`;
}

export function isWorkspacePathWithin(root: string, candidate: string): boolean {
  const normalizedRoot = normalizeWorkspacePath(root);
  const normalizedCandidate = normalizeWorkspacePath(candidate);
  return (
    normalizedRoot === "." ||
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(`${normalizedRoot}/`)
  );
}

export function relativeWorkspacePath(root: string, candidate: string): string | undefined {
  const normalizedRoot = normalizeWorkspacePath(root);
  const normalizedCandidate = normalizeWorkspacePath(candidate);
  if (!isWorkspacePathWithin(normalizedRoot, normalizedCandidate)) return undefined;
  return normalizedRoot === "." ? normalizedCandidate : normalizedCandidate.slice(normalizedRoot.length + 1);
}

export function normalizeWorkspacePath(value: string): string {
  const normalized = value
    .replace(/\\/gu, "/")
    .replace(/^\.\//u, "")
    .replace(/\/{2,}/gu, "/")
    .replace(/\/$/u, "");
  return normalized || ".";
}

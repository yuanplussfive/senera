import path from "node:path";

export interface SeneraGuestPathProjectionInput {
  hostRoot: string;
  hostPath: string;
  guestRoot: string;
}

export function projectHostPathToGuestPath(input: SeneraGuestPathProjectionInput): string {
  const parts = path
    .relative(path.resolve(input.hostRoot), path.resolve(input.hostPath))
    .split(path.sep)
    .filter(Boolean);

  return parts.length === 0
    ? input.guestRoot
    : path.posix.join(input.guestRoot, ...parts);
}

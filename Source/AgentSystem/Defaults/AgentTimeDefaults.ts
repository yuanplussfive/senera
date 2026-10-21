export function secondsToMilliseconds(seconds: number): number {
  return Math.round(seconds * 1000);
}

export function optionalSecondsToMilliseconds(seconds: number | undefined): number | undefined {
  return seconds === undefined ? undefined : secondsToMilliseconds(seconds);
}

export function disabledOrSecondsToMilliseconds(seconds: number): number {
  return seconds === -1 ? -1 : secondsToMilliseconds(seconds);
}

export function optionalDisabledOrSecondsToMilliseconds(seconds: number | undefined): number | undefined {
  return seconds === undefined ? undefined : disabledOrSecondsToMilliseconds(seconds);
}

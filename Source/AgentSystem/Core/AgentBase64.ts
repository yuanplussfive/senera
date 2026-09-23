/**
 * Validates standard padded Base64 without a backtracking regular expression.
 * Large image payloads can be several megabytes long; a repeated-group regex
 * makes V8 recurse over the whole string and can overflow the call stack.
 */
export function isAgentBase64(value: string): boolean {
  let significantLength = 0;
  let paddingStart = -1;

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (isBase64Whitespace(code)) continue;

    const position = significantLength;
    significantLength += 1;
    if (code === 0x3d) {
      paddingStart = paddingStart < 0 ? position : paddingStart;
      continue;
    }
    if (paddingStart >= 0 || !isBase64Character(code)) return false;
  }

  if (significantLength === 0 || significantLength % 4 !== 0) return false;
  if (paddingStart < 0) return true;
  return significantLength - paddingStart <= 2 && paddingStart >= significantLength - 2;
}

function isBase64Character(code: number): boolean {
  return (
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    (code >= 0x30 && code <= 0x39) ||
    code === 0x2b ||
    code === 0x2f
  );
}

function isBase64Whitespace(code: number): boolean {
  return code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d || code === 0x20;
}

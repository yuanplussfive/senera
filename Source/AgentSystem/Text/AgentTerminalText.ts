import { stripVTControlCharacters } from "node:util";

const FullWidthCodePointRanges = [
  [0x1100, 0x115f],
  [0x2329, 0x232a],
  [0x2e80, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f],
  [0x1f900, 0x1f9ff],
  [0x20000, 0x3fffd],
] as const;

export function measureTerminalWidth(value: string): number {
  const plain = stripVTControlCharacters(value);
  let width = 0;

  for (const symbol of plain) {
    width += isFullWidthSymbol(symbol) ? 2 : 1;
  }

  return Math.max(width, 1);
}

export function fitTerminalLine(value: string, width: number): string {
  if (width <= 0 || measureTerminalWidth(value) <= width) {
    return value;
  }

  const ellipsis = " ... ";
  const budget = Math.max(width - measureTerminalWidth(ellipsis), 0);
  const headBudget = Math.max(Math.floor(budget / 2), 0);
  const tailBudget = Math.max(budget - headBudget, 0);

  return `${sliceTerminalWidth(value, headBudget)}${ellipsis}${sliceTerminalWidthFromEnd(value, tailBudget)}`;
}

function sliceTerminalWidth(value: string, width: number): string {
  if (width <= 0) {
    return "";
  }

  let consumed = 0;
  let output = "";

  for (const symbol of value) {
    const symbolWidth = measureTerminalWidth(symbol);
    if (consumed + symbolWidth > width) {
      break;
    }

    output += symbol;
    consumed += symbolWidth;
  }

  return output;
}

function sliceTerminalWidthFromEnd(value: string, width: number): string {
  if (width <= 0) {
    return "";
  }

  const symbols = Array.from(value);
  let consumed = 0;
  let output = "";

  for (let index = symbols.length - 1; index >= 0; index -= 1) {
    const symbol = symbols[index];
    const symbolWidth = measureTerminalWidth(symbol);
    if (consumed + symbolWidth > width) {
      break;
    }

    output = `${symbol}${output}`;
    consumed += symbolWidth;
  }

  return output;
}

function isFullWidthSymbol(symbol: string): boolean {
  const codePoint = symbol.codePointAt(0);
  if (codePoint === undefined) {
    return false;
  }

  return FullWidthCodePointRanges.some(([start, end]) => codePoint >= start && codePoint <= end);
}

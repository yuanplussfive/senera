import { getFrontendLocale } from "../i18n/frontendLocaleStore";

export interface FileSizeFormatOptions {
  readonly base?: "binary" | "decimal";
  readonly locale?: string;
  readonly maximumFractionDigits?: number;
}

const FileSizeUnits = {
  binary: { divisor: 1024, units: ["B", "KiB", "MiB", "GiB", "TiB", "PiB", "EiB"] },
  decimal: { divisor: 1000, units: ["B", "kB", "MB", "GB", "TB", "PB", "EB"] },
} as const;

/** Shared byte formatting: unknown values stay unknown, and unit labels match the divisor. */
export function formatFileSize(bytes: number, options: FileSizeFormatOptions = {}): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  const { divisor, units } = FileSizeUnits[options.base ?? "binary"];
  const power = bytes < divisor ? 0 : Math.min(Math.floor(Math.log(bytes) / Math.log(divisor)), units.length - 1);
  const amount = bytes / divisor ** power;
  const maximumFractionDigits = options.maximumFractionDigits ?? (power === 0 || amount >= 10 ? 0 : 1);
  const value = new Intl.NumberFormat(options.locale ?? getFrontendLocale(), { maximumFractionDigits }).format(amount);
  return `${value} ${units[power]}`;
}

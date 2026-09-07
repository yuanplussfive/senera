import { twMerge } from "tailwind-merge";
import { clsx, type ClassValue } from "clsx";
import { getFrontendLocale } from "../i18n/frontendLocaleStore";
import { resolveRuntimeTimeZone } from "../config/runtimeConfig";

const integerFormatters = new Map<string, Intl.NumberFormat>();
const shortTimeFormatters = new Map<string, Intl.DateTimeFormat>();
const timeFormatters = new Map<string, Intl.DateTimeFormat>();
const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();

function getIntegerFormatter(locale: string): Intl.NumberFormat {
  const existing = integerFormatters.get(locale);
  if (existing) return existing;
  const formatter = new Intl.NumberFormat(locale);
  integerFormatters.set(locale, formatter);
  return formatter;
}

function getShortTimeFormatter(locale: string, timeZone: string): Intl.DateTimeFormat {
  const key = `${locale}:${timeZone}`;
  const existing = shortTimeFormatters.get(key);
  if (existing) return existing;
  const formatter = new Intl.DateTimeFormat(locale, {
    timeZone,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  shortTimeFormatters.set(key, formatter);
  return formatter;
}

function getTimeFormatter(timeZone: string): Intl.DateTimeFormat {
  const existing = timeFormatters.get(timeZone);
  if (existing) return existing;
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  timeFormatters.set(timeZone, formatter);
  return formatter;
}

function getDateTimeFormatter(locale: string, timeZone: string): Intl.DateTimeFormat {
  const key = `${locale}:${timeZone}`;
  const existing = dateTimeFormatters.get(key);
  if (existing) return existing;
  const formatter = new Intl.DateTimeFormat(locale, {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  dateTimeFormatters.set(key, formatter);
  return formatter;
}

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : getTimeFormatter(resolveRuntimeTimeZone()).format(date);
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : getDateTimeFormatter(getFrontendLocale(), resolveRuntimeTimeZone()).format(date);
}

export function formatDuration(startIso?: string, endIso?: string): string {
  if (!startIso) return "";
  try {
    const start = new Date(startIso).getTime();
    const end = endIso ? new Date(endIso).getTime() : Date.now();
    const elapsed = end - start;
    return elapsed > 0 ? formatDurationMs(elapsed) : "";
  } catch {
    return "";
  }
}

export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m${s.toString().padStart(2, "0")}s`;
}

export function hasMeasuredDuration(startIso?: string, endIso?: string): boolean {
  if (!startIso || !endIso) return false;
  try {
    const start = new Date(startIso).getTime();
    const end = new Date(endIso).getTime();
    return Number.isFinite(start) && Number.isFinite(end) && end > start;
  } catch {
    return false;
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)}KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 1 : 0)}MB`;
}

export function formatInteger(value: number): string {
  return getIntegerFormatter(getFrontendLocale()).format(value);
}

export function formatShortTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return getShortTimeFormatter(getFrontendLocale(), resolveRuntimeTimeZone()).format(date);
}

export function generateId(): string {
  const webCrypto = globalThis.crypto;
  if (typeof webCrypto?.randomUUID === "function") {
    return webCrypto.randomUUID();
  }
  if (typeof webCrypto?.getRandomValues !== "function") {
    throw new Error("A secure random source is required to generate identifiers.");
  }
  const bytes = webCrypto.getRandomValues(new Uint8Array(16));
  return `id-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

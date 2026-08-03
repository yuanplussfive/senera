import { timingSafeEqual } from "node:crypto";
import type http from "node:http";
import { AgentPiProxyProtocol } from "../PiShared/AgentPiProxyProtocol.js";

const BearerPrefix = "Bearer ";
const Ipv4MappedPrefix = "::ffff:";

export function authorizeAgentPiProxyRequest(request: http.IncomingMessage): boolean {
  return isLocalConnection(request) && matchesRuntimeApiKey(readBearerToken(request));
}

function readBearerToken(request: http.IncomingMessage): string | undefined {
  const value = request.headers.authorization;
  const authorization = Array.isArray(value) ? value[0] : value;
  if (!authorization?.startsWith(BearerPrefix)) return undefined;
  const token = authorization.slice(BearerPrefix.length).trim();
  return token || undefined;
}

function matchesRuntimeApiKey(candidate: string | undefined): boolean {
  if (!candidate) return false;
  const expected = Buffer.from(AgentPiProxyProtocol.apiKey);
  const actual = Buffer.from(candidate);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function isLocalConnection(request: http.IncomingMessage): boolean {
  const remoteAddress = normalizeAddress(request.socket.remoteAddress);
  if (!remoteAddress) return false;
  if (isLoopbackAddress(remoteAddress)) return true;

  const localAddress = normalizeAddress(request.socket.localAddress);
  return Boolean(localAddress && remoteAddress === localAddress);
}

function normalizeAddress(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith(Ipv4MappedPrefix) ? normalized.slice(Ipv4MappedPrefix.length) : normalized;
}

function isLoopbackAddress(value: string): boolean {
  return value === "127.0.0.1" || value === "::1";
}

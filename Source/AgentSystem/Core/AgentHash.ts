import { createHash } from "node:crypto";
import { stringifyAgentCanonicalJson } from "./AgentCanonicalJson.js";

export function sha256Hex(data: string | NodeJS.ArrayBufferView): string {
  return createHash("sha256").update(data).digest("hex");
}

/** 规范 JSON（码点排序）后取哈希，保证同一结构在任何环境得到同一指纹。 */
export function sha256HexOfCanonicalJson(value: unknown): string {
  return sha256Hex(stringifyAgentCanonicalJson(value));
}

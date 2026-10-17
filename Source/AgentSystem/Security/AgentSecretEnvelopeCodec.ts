import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isFileExistsError, isMissingFileError } from "../Core/AgentFs.js";
import { AgentBaseError } from "../Core/AgentBaseError.js";

const SecretEnvelopePrefix = "senera:secret:v1:";
const SecretKeyBytes = 32;
const SecretNonceBytes = 12;
const SecretAuthenticationTagBytes = 16;

export function isAgentSecretEnvelope(value: string): boolean {
  return value.startsWith(SecretEnvelopePrefix);
}

export interface AgentSecretEnvelopeCodecOptions {
  readonly keyPath: string;
  readonly keyEnvironmentVariable: string;
  readonly key?: Buffer;
  readonly environment?: NodeJS.ProcessEnv;
  readonly keyLabel?: string;
}

class AgentSecretKeyMissingError extends AgentBaseError {
  constructor(readonly keyPath: string) {
    super(`Secret key is missing: ${keyPath}.`);
  }
}

/** Authenticated encryption shared by secret-bearing persistence domains. */
export class AgentSecretEnvelopeCodec {
  private key?: Buffer;
  private readonly environment: NodeJS.ProcessEnv;
  readonly keyPath: string;

  constructor(private readonly options: AgentSecretEnvelopeCodecOptions) {
    this.key = options.key ? validateSecretKey(options.key) : undefined;
    this.environment = options.environment ?? process.env;
    this.keyPath = path.resolve(options.keyPath);
  }

  seal(value: string, context: string): string {
    const nonce = randomBytes(SecretNonceBytes);
    const cipher = createCipheriv("aes-256-gcm", this.readKey(true), nonce);
    cipher.setAAD(Buffer.from(context, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${SecretEnvelopePrefix}${nonce.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
  }

  digest(value: string | NodeJS.ArrayBufferView, context: string): string {
    const hmac = createHmac("sha256", this.readKey(true));
    hmac.update(context, "utf8");
    hmac.update("\u0000", "utf8");
    hmac.update(value);
    return hmac.digest("hex");
  }

  open(envelope: string, context: string, label: string): string {
    const segments = envelope.slice(SecretEnvelopePrefix.length).split(".");
    if (segments.length !== 3 || segments.some((segment) => !segment)) {
      throw new Error(`Invalid encrypted secret envelope for ${label}.`);
    }

    try {
      const [nonceText, tagText, ciphertextText] = segments;
      const nonce = Buffer.from(nonceText, "base64url");
      const tag = Buffer.from(tagText, "base64url");
      const ciphertext = Buffer.from(ciphertextText, "base64url");
      if (nonce.length !== SecretNonceBytes || tag.length !== SecretAuthenticationTagBytes) {
        throw new Error("Invalid nonce or authentication tag length.");
      }
      const decipher = createDecipheriv("aes-256-gcm", this.readKey(false), nonce);
      decipher.setAAD(Buffer.from(context, "utf8"));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    } catch (error) {
      const keyDetail =
        error instanceof AgentSecretKeyMissingError
          ? ` ${this.options.keyLabel ?? "Secret key"} is missing: ${error.keyPath}.`
          : "";
      throw new Error(
        `Unable to decrypt ${label}. Check ${this.options.keyEnvironmentVariable} or ${this.keyPath}.${keyDetail}`,
        { cause: error },
      );
    }
  }

  isSealed(value: string): boolean {
    return isAgentSecretEnvelope(value);
  }

  private readKey(createIfMissing: boolean): Buffer {
    if (this.key) return this.key;

    const environmentKey = this.environment[this.options.keyEnvironmentVariable]?.trim();
    if (environmentKey) {
      this.key = decodeSecretKey(environmentKey, this.options.keyEnvironmentVariable);
      return this.key;
    }

    this.key = createIfMissing ? readOrCreateLocalSecretKey(this.keyPath) : readLocalSecretKey(this.keyPath);
    return this.key;
  }
}

function readOrCreateLocalSecretKey(keyPath: string): Buffer {
  try {
    return decodeSecretKey(fs.readFileSync(keyPath, "utf8").trim(), keyPath);
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
  }

  fs.mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
  const generatedKey = randomBytes(SecretKeyBytes);
  try {
    fs.writeFileSync(keyPath, `${generatedKey.toString("base64url")}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    restrictFilePermissions(keyPath);
    return generatedKey;
  } catch (error) {
    if (!isFileExistsError(error)) throw error;
    return decodeSecretKey(fs.readFileSync(keyPath, "utf8").trim(), keyPath);
  }
}

function readLocalSecretKey(keyPath: string): Buffer {
  try {
    return decodeSecretKey(fs.readFileSync(keyPath, "utf8").trim(), keyPath);
  } catch (error) {
    if (isMissingFileError(error)) throw new AgentSecretKeyMissingError(keyPath);
    throw error;
  }
}

function decodeSecretKey(encoded: string, source: string): Buffer {
  const key = Buffer.from(encoded, "base64url");
  if (key.length !== SecretKeyBytes) throw new Error(`${source} must contain a base64url-encoded 32-byte key.`);
  return key;
}

function validateSecretKey(key: Buffer): Buffer {
  if (key.length !== SecretKeyBytes) throw new Error("Agent secret key must be 32 bytes.");
  return Buffer.from(key);
}

function restrictFilePermissions(filePath: string): void {
  if (process.platform !== "win32") fs.chmodSync(filePath, 0o600);
}

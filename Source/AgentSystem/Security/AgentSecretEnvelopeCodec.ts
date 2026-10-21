import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { AgentBaseError } from "../Core/AgentBaseError.js";
import type { AgentSecretKey, AgentSecretKeyRing } from "./AgentSecretKeyRing.js";

const SecretEnvelopeScheme = "senera:secret";
const SecretEnvelopePrefix = `${SecretEnvelopeScheme}:`;
const SecretEnvelopeVersionPattern = new RegExp(`^${SecretEnvelopeScheme}:v(\\d+):([\\w.-]+)$`, "u");
const CurrentSecretEnvelopeVersion = 2;
const LegacySecretEnvelopeVersion = 1;
const SecretNonceBytes = 12;
const SecretAuthenticationTagBytes = 16;

export type AgentSecretOpenFailure = "missing_key" | "unknown_key" | "authentication_failed" | "unsupported_format";

/** A stored secret this release cannot open. Callers report it per secret instead of failing wholesale. */
export class AgentSecretUndecryptableError extends AgentBaseError {
  constructor(
    readonly label: string,
    readonly failure: AgentSecretOpenFailure,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/**
 * True for anything naming the secret scheme, including a truncated or future-versioned value. These
 * are stored secret material: reading one as plaintext would seal a ciphertext as if it were a key.
 */
export function carriesAgentSecretScheme(value: string): boolean {
  return value.startsWith(SecretEnvelopePrefix);
}

/** True when secret material appears anywhere inside a longer string. */
export function containsAgentSecretEnvelope(value: string): boolean {
  return value.includes(SecretEnvelopePrefix);
}

export interface AgentSecretOpenResult {
  readonly value: string;
  /** The envelope still uses an older format or an older key, so the caller should re-seal it. */
  readonly needsRewrap: boolean;
}

export interface AgentSecretEnvelopeCodecOptions {
  readonly keyRing: AgentSecretKeyRing;
  /**
   * Additional authenticated data shared by every secret in this domain. It separates one secret
   * store from another and deliberately excludes mutable identity such as a provider id, so
   * renaming a provider cannot strand the credential attached to it.
   */
  readonly context: string;
}

/** Authenticated encryption shared by secret-bearing persistence domains. */
export class AgentSecretEnvelopeCodec {
  private readonly keyRing: AgentSecretKeyRing;
  private readonly context: string;

  constructor(options: AgentSecretEnvelopeCodecOptions) {
    this.keyRing = options.keyRing;
    this.context = options.context;
  }

  seal(value: string): string {
    const key = this.keyRing.activeKey();
    const nonce = randomBytes(SecretNonceBytes);
    const cipher = createCipheriv("aes-256-gcm", key.bytes, nonce);
    cipher.setAAD(Buffer.from(this.context, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const segments = [key.id, nonce, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url"));
    return `${SecretEnvelopeScheme}:v${CurrentSecretEnvelopeVersion}:${segments.join(".")}`;
  }

  /**
   * @param legacyContext authenticated data used by releases before the keyring, needed to open
   *   envelopes that predate the domain-wide context.
   */
  open(envelope: string, label: string, legacyContext: string): AgentSecretOpenResult {
    const parsed = parseEnvelope(envelope);
    if (!parsed) {
      throw new AgentSecretUndecryptableError(label, "unsupported_format", `Malformed secret envelope for ${label}.`);
    }

    const keys = this.keysFor(parsed);
    if (keys.length === 0) throw this.noKeyError(label, parsed);

    for (const key of keys) {
      const value = this.decrypt(parsed, key, legacyContext);
      if (value !== undefined) {
        return { value, needsRewrap: this.needsRewrap(parsed, key) };
      }
    }
    throw new AgentSecretUndecryptableError(
      label,
      "authentication_failed",
      `Unable to decrypt ${label}: no key on this host authenticates it. Check ${this.keyRing.describeSource()}.`,
    );
  }

  /**
   * v2 envelopes name the key that sealed them, so exactly one candidate applies. v1 envelopes
   * carry no key id, so every key this host has sealed with is tried in order.
   */
  private keysFor(parsed: ParsedEnvelope): readonly AgentSecretKey[] {
    if (parsed.version === CurrentSecretEnvelopeVersion) {
      const key = this.keyRing.findKey(parsed.keyId);
      return key ? [key] : [];
    }
    return this.keyRing.secretKeys();
  }

  private decrypt(parsed: ParsedEnvelope, key: AgentSecretKey, legacyContext: string): string | undefined {
    try {
      const context = parsed.version === CurrentSecretEnvelopeVersion ? this.context : legacyContext;
      const decipher = createDecipheriv("aes-256-gcm", key.bytes, parsed.nonce);
      decipher.setAAD(Buffer.from(context, "utf8"));
      decipher.setAuthTag(parsed.tag);
      return Buffer.concat([decipher.update(parsed.ciphertext), decipher.final()]).toString("utf8");
    } catch {
      return undefined;
    }
  }

  private needsRewrap(parsed: ParsedEnvelope, key: AgentSecretKey): boolean {
    if (parsed.version !== CurrentSecretEnvelopeVersion) return true;
    return key.id !== this.keyRing.peekActiveKey()?.id;
  }

  private noKeyError(label: string, parsed: ParsedEnvelope): AgentSecretUndecryptableError {
    if (parsed.version === LegacySecretEnvelopeVersion) {
      return new AgentSecretUndecryptableError(
        label,
        "missing_key",
        `Unable to decrypt ${label}: this host has no key from before the shared keyring. Check ${this.keyRing.describeSource()}.`,
      );
    }
    return new AgentSecretUndecryptableError(
      label,
      "unknown_key",
      `Unable to decrypt ${label}: key ${parsed.keyId} is not available under ${this.keyRing.keysRoot}.`,
    );
  }
}

type ParsedEnvelope =
  | {
      readonly version: typeof LegacySecretEnvelopeVersion;
      readonly nonce: Buffer;
      readonly tag: Buffer;
      readonly ciphertext: Buffer;
    }
  | {
      readonly version: typeof CurrentSecretEnvelopeVersion;
      readonly keyId: string;
      readonly nonce: Buffer;
      readonly tag: Buffer;
      readonly ciphertext: Buffer;
    };

function parseEnvelope(envelope: string): ParsedEnvelope | undefined {
  const match = SecretEnvelopeVersionPattern.exec(envelope);
  if (!match) return undefined;
  const segments = match[2]!.split(".");
  const version = Number(match[1]);

  if (version === CurrentSecretEnvelopeVersion && segments.length === 4) {
    const [keyId, nonceText, tagText, ciphertextText] = segments as [string, string, string, string];
    const parts = decodeCipherParts(nonceText, tagText, ciphertextText);
    return parts && { version, keyId, ...parts };
  }
  if (version === LegacySecretEnvelopeVersion && segments.length === 3) {
    const [nonceText, tagText, ciphertextText] = segments as [string, string, string];
    const parts = decodeCipherParts(nonceText, tagText, ciphertextText);
    return parts && { version, ...parts };
  }
  return undefined;
}

function decodeCipherParts(
  nonceText: string,
  tagText: string,
  ciphertextText: string,
): { nonce: Buffer; tag: Buffer; ciphertext: Buffer } | undefined {
  const nonce = Buffer.from(nonceText, "base64url");
  const tag = Buffer.from(tagText, "base64url");
  const ciphertext = Buffer.from(ciphertextText, "base64url");
  if (nonce.length !== SecretNonceBytes || tag.length !== SecretAuthenticationTagBytes) return undefined;
  return { nonce, tag, ciphertext };
}

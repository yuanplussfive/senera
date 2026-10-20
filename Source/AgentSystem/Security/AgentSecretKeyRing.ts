import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isFileExistsError, isMissingFileError, listDirectoryNamesSync, removeAgentPathSync } from "../Core/AgentFs.js";
import { errorMessage } from "../Core/AgentErrors.js";
import { resolveAgentApplicationPaths } from "../Core/AgentApplicationPaths.js";

const SecretKeyBytes = 32;
const SecretKeyIdHexLength = 8;
const RetiredKeyFileNamePattern = new RegExp(`^[0-9a-f]{${SecretKeyIdHexLength}}\\.key$`, "u");
const ActiveKeyFileName = "secret.key";
const KeyFileMode = 0o600;
const KeyDirectoryMode = 0o700;

export interface AgentSecretKey {
  /** Short stable identifier embedded in every envelope this key seals. */
  readonly id: string;
  readonly bytes: Buffer;
}

/**
 * One pre-keyring key file this host found outside the keyring. Moving it in preserves the ability to
 * open envelopes that still name it, and takes the key out of a directory the user may version.
 */
export interface AgentLegacySecretKeyRelocation {
  readonly sourcePath: string;
  readonly keyId: string;
  /** False when the file could not be moved, so it still sits where it was found. */
  readonly relocated: boolean;
  /** Operating-system reason for a failed move, reported apart from the localized message. */
  readonly failure?: string;
}

export interface AgentSecretKeyRingOptions {
  /** Secret domains keep separate material so one exposed key cannot open the other store. */
  readonly domain: string;
  /** Deployment override so containers and CI pin one key instead of persisting it. */
  readonly keyEnvironmentVariable: string;
  /** Key files written by releases that stored one key per workspace instead of per host. */
  readonly legacyKeyPaths?: readonly string[];
  /** Host-owned key material for embedders that keep secrets in an OS keystore. */
  readonly key?: Buffer;
  readonly environment?: NodeJS.ProcessEnv;
  readonly keysRoot?: string;
}

/**
 * Host-scoped master key for one secret domain. Envelopes name the key that sealed them, so
 * replacing the active key no longer strands stored credentials: keep the previous material in the
 * domain directory as `<id>.key` and it stays readable.
 */
export class AgentSecretKeyRing {
  readonly keysRoot: string;
  readonly domainDirectory: string;
  readonly keyFilePath: string;
  private readonly options: AgentSecretKeyRingOptions;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly injectedKey: AgentSecretKey | undefined;
  private resolvedActiveKey: AgentSecretKey | undefined;
  private scannedLegacyKeys: readonly AgentSecretKey[] | undefined;
  private relocatedLegacyKeysValue: AgentLegacySecretKeyRelocation[] = [];
  private readonly undecodableKeyFiles = new Set<string>();

  constructor(options: AgentSecretKeyRingOptions) {
    this.options = options;
    this.environment = options.environment ?? process.env;
    this.injectedKey = options.key ? toAgentSecretKey(validateKey(options.key)) : undefined;
    this.keysRoot = path.resolve(options.keysRoot ?? resolveAgentApplicationPaths().secretKeysRoot);
    this.domainDirectory = path.join(this.keysRoot, options.domain);
    this.keyFilePath = path.join(this.domainDirectory, ActiveKeyFileName);
  }

  /** Key used for new envelopes; created on first write and never derived from workspace material. */
  activeKey(): AgentSecretKey {
    const existing = this.peekActiveKey();
    if (existing) return existing;

    const key = randomBytes(SecretKeyBytes);
    fs.mkdirSync(this.domainDirectory, { recursive: true, mode: KeyDirectoryMode });
    try {
      fs.writeFileSync(this.keyFilePath, `${key.toString("base64url")}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: KeyFileMode,
      });
      restrictKeyFilePermissions(this.keyFilePath);
    } catch (error) {
      if (!isFileExistsError(error)) throw error;
      const concurrent = this.readCandidateKeyFile(this.keyFilePath);
      if (!concurrent) {
        throw new Error(`${this.keyFilePath} exists but does not hold a usable 32-byte key; fix or remove it.`, {
          cause: error,
        });
      }
      this.resolvedActiveKey = concurrent;
      return concurrent;
    }
    this.resolvedActiveKey = toAgentSecretKey(key);
    return this.resolvedActiveKey;
  }

  /** Key the ring would seal with now, resolved without creating anything. */
  peekActiveKey(): AgentSecretKey | undefined {
    if (this.resolvedActiveKey) return this.resolvedActiveKey;
    const key =
      this.injectedKey ??
      readEnvironmentKey(this.options.keyEnvironmentVariable, this.environment) ??
      this.readCandidateKeyFile(this.keyFilePath);
    if (key) this.resolvedActiveKey = key;
    return key;
  }

  /** Resolve the key an envelope names, without ever creating key material. */
  findKey(id: string): AgentSecretKey | undefined {
    return this.secretKeys().find((key) => key.id === id);
  }

  /**
   * Every key this host has sealed secrets with: the current one first, then retired and
   * pre-keyring material. Releases before the keyring wrote one key per workspace, so a host can
   * hold several, and a stored envelope is opened by trying them in order.
   */
  secretKeys(): readonly AgentSecretKey[] {
    const active = this.peekActiveKey();
    if (!active) return this.scannedKeys();
    return [active, ...this.scannedKeys().filter((key) => key.id !== active.id)];
  }

  /** Retired and pre-keyring key files; the active key is read live so a just-created key counts. */
  private scannedKeys(): readonly AgentSecretKey[] {
    if (this.scannedLegacyKeys) return this.scannedLegacyKeys;
    const candidates: AgentSecretKey[] = [];
    const seen = new Set<string>();
    const add = (key: AgentSecretKey | undefined): void => {
      if (!key || seen.has(key.id)) return;
      seen.add(key.id);
      candidates.push(key);
    };
    for (const keyPath of this.options.legacyKeyPaths ?? []) add(this.relocateLegacyKey(keyPath));
    for (const fileName of retiredKeyFileNames(this.domainDirectory)) {
      add(this.readCandidateKeyFile(path.join(this.domainDirectory, fileName)));
    }
    this.scannedLegacyKeys = candidates;
    return candidates;
  }

  /**
   * Pre-keyring releases wrote one key per workspace, inside the user's own project directory. Once
   * this host can open such a key it belongs in the keyring as a retired candidate, so the key moves
   * in and the workspace copy goes: every envelope that still names it stays readable, while a
   * directory the user may push to a repository stops holding key material. A move that fails leaves
   * the file where it is and still counts the key, because opening secrets outranks housekeeping.
   */
  private relocateLegacyKey(keyPath: string): AgentSecretKey | undefined {
    const key = this.readCandidateKeyFile(keyPath);
    if (!key) return undefined;
    try {
      this.ensureRetiredKeyFile(key);
      removeAgentPathSync(keyPath, { force: true });
    } catch (error) {
      // A key this host could not move still opens its envelopes from where it is found.
      this.relocatedLegacyKeysValue.push({
        sourcePath: keyPath,
        keyId: key.id,
        relocated: false,
        failure: errorMessage(error),
      });
      return key;
    }
    this.relocatedLegacyKeysValue.push({ sourcePath: keyPath, keyId: key.id, relocated: true });
    return key;
  }

  /** Write the key into the domain directory under the id it already hashes to. */
  private ensureRetiredKeyFile(key: AgentSecretKey): void {
    const retiredPath = path.join(this.domainDirectory, `${key.id}.key`);
    fs.mkdirSync(this.domainDirectory, { recursive: true, mode: KeyDirectoryMode });
    try {
      fs.writeFileSync(retiredPath, `${key.bytes.toString("base64url")}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: KeyFileMode,
      });
      restrictKeyFilePermissions(retiredPath);
      return;
    } catch (error) {
      // Windows reports EEXIST for any occupant of the path, not only for a file.
      if (!isFileExistsError(error)) throw error;
    }
    // One id can only mean one byte sequence, so anything at this path that is not this key means the
    // destination is unusable, and the only copy worth keeping is the one already readable.
    const occupant = this.readCandidateKeyFile(retiredPath);
    if (!occupant || occupant.id !== key.id) {
      throw new Error(`${retiredPath} does not hold the key it names.`);
    }
  }

  /** Pre-keyring key files this host found, and whether each one left the workspace. */
  relocatedLegacyKeys(): readonly AgentLegacySecretKeyRelocation[] {
    if (!this.scannedLegacyKeys) this.secretKeys();
    return this.relocatedLegacyKeysValue;
  }

  /** Origin shown when a secret cannot be opened, including key files this host could not read. */
  describeSource(): string {
    const source = `${this.options.keyEnvironmentVariable} or ${this.keyFilePath}`;
    return this.undecodableKeyFiles.size === 0
      ? source
      : `${source}; these key files are unreadable: ${[...this.undecodableKeyFiles].join(", ")}`;
  }

  /**
   * One broken key file must not cost the user every secret on the host, so an unreadable file is
   * skipped and named in describeSource instead of thrown.
   */
  private readCandidateKeyFile(keyPath: string): AgentSecretKey | undefined {
    try {
      return readKeyFile(keyPath);
    } catch (error) {
      if (isMissingFileError(error)) return undefined;
      this.undecodableKeyFiles.add(keyPath);
      return undefined;
    }
  }
}

export function toAgentSecretKey(bytes: Buffer): AgentSecretKey {
  return { id: createHash("sha256").update(bytes).digest("hex").slice(0, SecretKeyIdHexLength), bytes };
}

function readKeyFile(keyPath: string): AgentSecretKey | undefined {
  let content: string;
  try {
    content = fs.readFileSync(keyPath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    throw error;
  }
  return toAgentSecretKey(decodeKey(content.trim(), keyPath));
}

function retiredKeyFileNames(domainDirectory: string): readonly string[] {
  return listDirectoryNamesSync(domainDirectory).filter((name) => RetiredKeyFileNamePattern.test(name));
}

function readEnvironmentKey(name: string, environment: NodeJS.ProcessEnv): AgentSecretKey | undefined {
  const encoded = environment[name]?.trim();
  return encoded ? toAgentSecretKey(decodeKey(encoded, name)) : undefined;
}

function decodeKey(encoded: string, source: string): Buffer {
  const key = Buffer.from(encoded, "base64url");
  if (key.length !== SecretKeyBytes) throw new Error(`${source} must contain a base64url-encoded 32-byte key.`);
  return key;
}

function validateKey(key: Buffer): Buffer {
  if (key.length !== SecretKeyBytes) throw new Error("Agent secret key must be 32 bytes.");
  return Buffer.from(key);
}

function restrictKeyFilePermissions(keyPath: string): void {
  if (process.platform !== "win32") fs.chmodSync(keyPath, KeyFileMode);
}

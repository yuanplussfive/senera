import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";

const PasswordMinimumLength = 15;
const PasswordMaximumLength = 1024;
const PasswordKeyLength = 64;
const PasswordScryptParameters = {
  cost: 65_536,
  blockSize: 8,
  parallelization: 1,
  maxmem: 96 * 1024 * 1024,
} as const;

const LoginNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$/;

const PasswordHashSchema = z
  .object({
    algorithm: z.literal("scrypt"),
    salt: z.string().min(1),
    hash: z.string().min(1),
    keyLength: z.number().int().positive(),
    cost: z.number().int().positive(),
    blockSize: z.number().int().positive(),
    parallelization: z.number().int().positive(),
  })
  .strict();

const AccountDocumentSchema = z
  .object({
    version: z.literal(1),
    id: z.string().min(1),
    loginName: z.string().min(1),
    displayName: z.string().min(1),
    password: PasswordHashSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export interface AgentLocalAdminAccount {
  readonly id: string;
  readonly loginName: string;
  readonly displayName: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AgentLocalAdminAccountInput {
  readonly loginName: string;
  readonly displayName: string;
  readonly password: string;
}

type AccountDocument = z.infer<typeof AccountDocumentSchema>;

export class AgentLocalAdminAccountStore {
  constructor(readonly filePath: string) {}

  exists(): boolean {
    return fs.existsSync(this.filePath);
  }

  read(): AgentLocalAdminAccount | undefined {
    const document = this.readDocument();
    return document ? projectAccount(document) : undefined;
  }

  require(): AgentLocalAdminAccount {
    const account = this.read();
    if (!account) {
      throw new Error(agentErrorMessage("auth.accountMissing", { path: this.filePath }));
    }
    return account;
  }

  async initialize(input: AgentLocalAdminAccountInput): Promise<AgentLocalAdminAccount> {
    if (this.exists()) {
      throw new Error(agentErrorMessage("auth.accountExists", { path: this.filePath }));
    }

    const account = await createAccountDocument(input);
    this.writeDocument(account);
    return projectAccount(account);
  }

  async resetPassword(input: AgentLocalAdminAccountInput): Promise<AgentLocalAdminAccount> {
    const current = this.readDocument();
    if (!current) {
      throw new Error(agentErrorMessage("auth.accountMissing", { path: this.filePath }));
    }

    const loginName = normalizeLoginName(input.loginName);
    if (loginName !== current.loginName) {
      throw new Error(agentErrorMessage("auth.resetLoginNameMismatch"));
    }

    const next: AccountDocument = {
      ...current,
      displayName: normalizeDisplayName(input.displayName),
      password: await hashPassword(input.password),
      updatedAt: new Date().toISOString(),
    };
    this.writeDocument(next);
    return projectAccount(next);
  }

  async verify(loginName: string, password: string): Promise<AgentLocalAdminAccount | undefined> {
    const account = this.readDocument();
    if (!account) {
      return undefined;
    }

    const normalizedLoginName = normalizeLoginNameSafely(loginName);
    const passwordMatches = await verifyPassword(password, account.password);
    return normalizedLoginName === account.loginName && passwordMatches ? projectAccount(account) : undefined;
  }

  private readDocument(): AccountDocument | undefined {
    if (!this.exists()) {
      return undefined;
    }

    const value = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as unknown;
    const document = AccountDocumentSchema.parse(value);
    const loginName = normalizeLoginName(document.loginName);
    if (document.loginName !== loginName) {
      throw new Error(agentErrorMessage("auth.loginNameNotNormalized", { path: this.filePath }));
    }
    return document;
  }

  private writeDocument(document: AccountDocument): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporaryPath, this.filePath);
    try {
      fs.chmodSync(this.filePath, 0o600);
    } catch {
      // Windows does not map POSIX file modes. The ACL remains the deployment owner's responsibility.
    }
  }
}

export function normalizeLoginName(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!LoginNamePattern.test(normalized)) {
    throw new Error(agentErrorMessage("auth.loginNameInvalid"));
  }
  return normalized;
}

function normalizeLoginNameSafely(value: string): string | undefined {
  try {
    return normalizeLoginName(value);
  } catch {
    return undefined;
  }
}

export function normalizeDisplayName(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 64) {
    throw new Error(agentErrorMessage("auth.displayNameInvalid"));
  }
  return normalized;
}

export function validateAdminPassword(value: string): void {
  if (value.length < PasswordMinimumLength || value.length > PasswordMaximumLength) {
    throw new Error(
      agentErrorMessage("auth.passwordLengthInvalid", {
        min: PasswordMinimumLength,
        max: PasswordMaximumLength,
      }),
    );
  }
}

async function createAccountDocument(input: AgentLocalAdminAccountInput): Promise<AccountDocument> {
  return {
    version: 1,
    id: randomBytes(18).toString("base64url"),
    loginName: normalizeLoginName(input.loginName),
    displayName: normalizeDisplayName(input.displayName),
    password: await hashPassword(input.password),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function hashPassword(password: string): Promise<z.infer<typeof PasswordHashSchema>> {
  validateAdminPassword(password);
  const salt = randomBytes(16);
  const hash = await derivePassword(password, salt, PasswordScryptParameters, PasswordKeyLength);
  return {
    algorithm: "scrypt",
    salt: salt.toString("base64url"),
    hash: hash.toString("base64url"),
    keyLength: PasswordKeyLength,
    cost: PasswordScryptParameters.cost,
    blockSize: PasswordScryptParameters.blockSize,
    parallelization: PasswordScryptParameters.parallelization,
  };
}

async function verifyPassword(password: string, stored: z.infer<typeof PasswordHashSchema>): Promise<boolean> {
  if (password.length > PasswordMaximumLength) {
    return false;
  }
  const salt = Buffer.from(stored.salt, "base64url");
  const expected = Buffer.from(stored.hash, "base64url");
  const actual = await derivePassword(
    password,
    salt,
    {
      cost: stored.cost,
      blockSize: stored.blockSize,
      parallelization: stored.parallelization,
      maxmem: Math.max(96 * 1024 * 1024, stored.cost * stored.blockSize * 256),
    },
    stored.keyLength,
  );
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function derivePassword(
  password: string,
  salt: Buffer,
  parameters: {
    readonly cost: number;
    readonly blockSize: number;
    readonly parallelization: number;
    readonly maxmem: number;
  },
  keyLength: number,
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password,
      salt,
      keyLength,
      {
        N: parameters.cost,
        r: parameters.blockSize,
        p: parameters.parallelization,
        maxmem: parameters.maxmem,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(derivedKey);
      },
    );
  });
}

function projectAccount(document: AccountDocument): AgentLocalAdminAccount {
  return {
    id: document.id,
    loginName: document.loginName,
    displayName: document.displayName,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

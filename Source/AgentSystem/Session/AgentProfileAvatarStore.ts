import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeFileAtomic } from "../Core/AgentFs.js";
import { resolveAgentWorkspaceLayout } from "../Core/AgentWorkspaceLayout.js";

export const AgentProfileAvatarIdentities = {
  User: "user",
  Assistant: "assistant",
} as const;

export type AgentProfileAvatarIdentity =
  (typeof AgentProfileAvatarIdentities)[keyof typeof AgentProfileAvatarIdentities];

export const AgentProfileAvatarLimits = {
  MaxBytes: 512 * 1024,
} as const;

const AvatarExtensions: Record<string, string> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export class AgentProfileAvatarStore {
  private readonly workspaceRoot: string;
  private readonly root: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.root = resolveAgentWorkspaceLayout(workspaceRoot).profileAvatarRoot;
  }

  async save(identity: AgentProfileAvatarIdentity, bytes: Uint8Array, mime = "image/jpeg"): Promise<string> {
    if (bytes.byteLength === 0 || bytes.byteLength > AgentProfileAvatarLimits.MaxBytes) {
      throw new Error("Profile avatar is empty or too large.");
    }
    const extension = AvatarExtensions[mime];
    if (!extension) throw new Error("Profile avatar format is not supported.");
    const digest = crypto.createHash("sha256").update(bytes).digest("hex");
    const fileName = `${identity}-${digest}.${extension}`;
    const target = path.join(this.root, fileName);
    await writeFileAtomic(target, bytes, { mode: 0o600, directoryMode: 0o700 });
    return path.relative(this.workspaceRoot, target).split(path.sep).join("/");
  }

  async saveDataUrl(identity: AgentProfileAvatarIdentity, value: string): Promise<string> {
    const match = /^data:(image\/(?:png|jpe?g|webp|gif));base64,([a-z0-9+/=\s]+)$/i.exec(value);
    if (!match) throw new Error("Profile avatar data is invalid.");
    const mime = match[1].toLowerCase().replace("image/jpg", "image/jpeg");
    return this.save(identity, Buffer.from(match[2].replace(/\s+/gu, ""), "base64"), mime);
  }

  resolveStoredPath(identity: AgentProfileAvatarIdentity, relativePath: string | null | undefined): string | undefined {
    if (!relativePath) return undefined;
    const target = path.resolve(this.workspaceRoot, relativePath);
    const relativeToRoot = path.relative(this.root, target);
    const fileName = path.basename(target);
    const extension = path.extname(fileName).slice(1).toLowerCase();
    const digest = path.basename(fileName, path.extname(fileName)).slice(identity.length + 1);
    if (
      relativeToRoot === ".." ||
      relativeToRoot.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeToRoot) ||
      !fileName.startsWith(`${identity}-`) ||
      !/^[a-f0-9]{64}$/u.test(digest) ||
      !Object.values(AvatarExtensions).includes(extension)
    ) {
      return undefined;
    }
    return target;
  }

  async isReadable(identity: AgentProfileAvatarIdentity, relativePath: string | null | undefined): Promise<boolean> {
    const target = this.resolveStoredPath(identity, relativePath);
    if (!target) return false;
    try {
      const stat = await fs.promises.stat(target);
      return stat.isFile() && stat.size > 0 && stat.size <= AgentProfileAvatarLimits.MaxBytes;
    } catch {
      return false;
    }
  }

  async remove(identity: AgentProfileAvatarIdentity, relativePath: string | null | undefined): Promise<void> {
    const target = this.resolveStoredPath(identity, relativePath);
    if (!target) return;
    await fs.promises.unlink(target).catch((error: unknown) => {
      if (!isMissingFileError(error)) throw error;
    });
  }
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

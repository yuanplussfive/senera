import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

interface CachedFileRevision {
  readonly metadata: string;
  readonly contentDigest: string;
}

/**
 * Computes deterministic directory revisions while retaining content hashes for
 * files whose filesystem identity and metadata have not changed.
 */
export class AgentDirectoryRevisionCache {
  private readonly filesByRoot = new Map<string, ReadonlyMap<string, CachedFileRevision>>();

  revision(rootPath: string): string {
    const root = path.resolve(rootPath);
    const revision = crypto.createHash("sha256");
    if (!fs.existsSync(root)) {
      this.filesByRoot.delete(root);
      return revision.digest("hex");
    }

    const rootStat = fs.lstatSync(root, { bigint: true });
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw new Error(`Expected a regular directory: ${root}`);
    }

    const previous = this.filesByRoot.get(root) ?? new Map<string, CachedFileRevision>();
    const current = new Map<string, CachedFileRevision>();
    for (const file of regularFiles(root)) {
      const relativePath = path.relative(root, file.path).split(path.sep).join("/");
      const metadata = fileMetadataIdentity(file.stat);
      const cached = previous.get(relativePath);
      const contentDigest =
        cached?.metadata === metadata
          ? cached.contentDigest
          : crypto.createHash("sha256").update(fs.readFileSync(file.path)).digest("hex");
      current.set(relativePath, { metadata, contentDigest });
      revision.update(relativePath).update("\0").update(contentDigest).update("\0");
    }
    this.filesByRoot.set(root, current);
    return revision.digest("hex");
  }

  clear(rootPath?: string): void {
    if (rootPath === undefined) this.filesByRoot.clear();
    else this.filesByRoot.delete(path.resolve(rootPath));
  }
}

const sharedDirectoryRevisionCache = new AgentDirectoryRevisionCache();

export function agentDirectoryRevision(rootPath: string): string {
  return sharedDirectoryRevisionCache.revision(rootPath);
}

interface RegularFile {
  readonly path: string;
  readonly stat: fs.BigIntStats;
}

function regularFiles(root: string): RegularFile[] {
  const files: RegularFile[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Directory trees cannot contain symbolic links: ${entryPath}`);
      if (entry.isDirectory()) visit(entryPath);
      else if (entry.isFile()) files.push({ path: entryPath, stat: fs.lstatSync(entryPath, { bigint: true }) });
      else throw new Error(`Directory trees can only contain regular files: ${entryPath}`);
    }
  };
  visit(root);
  return files;
}

function fileMetadataIdentity(stat: fs.BigIntStats): string {
  return [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");
}

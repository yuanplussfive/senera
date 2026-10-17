import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, expect, test } from "vitest";
import {
  copyAgentPathSync,
  removeAgentPathSync,
  removeAgentPathWithRetry,
  writeFileAtomic,
  writeFileAtomicSync,
} from "../../../Source/AgentSystem/Core/AgentFs.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => removeAgentPathWithRetry(root, { recursive: true })));
});

test("writes and removes files below a Unicode workspace path on Windows", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "senera-agent-fs-"));
  temporaryRoots.push(root);
  const workspace = path.join(root, "工作区 with spaces");
  const filePath = path.join(workspace, "配置.json");
  const syncFilePath = path.join(workspace, "同步配置.json");
  const copySource = path.join(workspace, "源目录");
  const copyTarget = path.join(workspace, "目标目录");

  await writeFileAtomic(filePath, '{"ok":true}', { fsync: true });
  writeFileAtomicSync(syncFilePath, '{"ok":true}', { fsync: true });
  await fs.mkdir(path.join(copySource, "嵌套"), { recursive: true });
  await fs.writeFile(path.join(copySource, "嵌套", "内容.txt"), "复制成功", "utf8");
  copyAgentPathSync(copySource, copyTarget, { recursive: true, force: false });

  await expect(fs.readFile(filePath, "utf8")).resolves.toBe('{"ok":true}');
  await expect(fs.readFile(syncFilePath, "utf8")).resolves.toBe('{"ok":true}');
  await expect(fs.readFile(path.join(copyTarget, "嵌套", "内容.txt"), "utf8")).resolves.toBe("复制成功");
  removeAgentPathSync(workspace, { recursive: true });
  await expect(fs.access(workspace)).rejects.toMatchObject({ code: "ENOENT" });
});

import path from "node:path";
import iconv from "iconv-lite";
import { describe, expect, test } from "vitest";
import { decodeSeneraProcessOutput } from "../../../Source/AgentSystem/Execution/SeneraProcessOutputDecoder.js";
import { SeneraProcessOutputBuffer } from "../../../Source/AgentSystem/Execution/SeneraProcessOutputBuffer.js";
import { projectHostPathToGuestPath } from "../../../Source/AgentSystem/Execution/SeneraGuestPathProjection.js";

describe("Execution behavior", () => {
  test("decodes UTF-8 by default and auto-decodes legacy Windows command output", () => {
    expect(decodeSeneraProcessOutput(Buffer.from("hello", "utf8"))).toBe("hello");

    const gb18030 = iconv.encode("所在位置 行:1 字符: 15", "gb18030");
    expect(decodeSeneraProcessOutput(gb18030, { encoding: "auto" })).toContain("所在位置");
  });

  test("buffers stdout and stderr independently with byte accounting", () => {
    const output = new SeneraProcessOutputBuffer({ encoding: "auto" });
    const stderrText = "错误";

    output.pushStdout("alpha");
    output.pushStdout(Buffer.from(" beta"));
    output.pushStderr(Buffer.from(stderrText, "utf8"));

    expect(output.stdout()).toBe("alpha beta");
    expect(output.stderr()).toBe(stderrText);
    expect(output.stdoutBytes).toBe(Buffer.byteLength("alpha beta"));
    expect(output.stderrBytes).toBe(Buffer.byteLength(stderrText));
  });

  test("projects host paths into stable POSIX guest paths", () => {
    const hostRoot = path.resolve("workspace");
    const nested = path.join(hostRoot, "dir", "file.txt");

    expect(
      projectHostPathToGuestPath({
        hostRoot,
        hostPath: hostRoot,
        guestRoot: "/workspace",
      }),
    ).toBe("/workspace");
    expect(
      projectHostPathToGuestPath({
        hostRoot,
        hostPath: nested,
        guestRoot: "/workspace",
      }),
    ).toBe("/workspace/dir/file.txt");
  });
});

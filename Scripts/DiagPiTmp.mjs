import { readFileSync } from "node:fs";

const file =
  ".senera/pi-sessions/2026-09-17T18-42-07-851Z_senera_channel_b0e32a4789c2b09619dd3c188e89f7e9013a2af0.jsonl";
const lines = readFileSync(file, "utf8")
  .split("\n")
  .filter((l) => l.trim() !== "");
for (let i = 0; i < lines.length; i++) {
  let obj;
  try {
    obj = JSON.parse(lines[i]);
  } catch {
    console.log(`L${i + 1}: <unparseable>`);
    continue;
  }
  if (obj?.type !== "message") continue;
  const raw = JSON.stringify(obj);
  const hits = [];
  let idx = raw.indexOf("ToolSearch");
  while (idx !== -1 && hits.length < 6) {
    hits.push(raw.slice(Math.max(0, idx - 120), Math.min(raw.length, idx + 240)));
    idx = raw.indexOf("ToolSearch", idx + 1);
  }
  console.log(`\n===== L${i + 1} message @ ${obj?.timestamp ?? ""} ToolSearch 命中 ${hits.length} =====`);
  for (const h of hits) console.log("  ⟪" + h.replace(/\\n/g, "⏎") + "⟫");
}

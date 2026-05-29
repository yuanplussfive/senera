const fs = require("node:fs");
const path = require("node:path");

const distPath = path.resolve(process.cwd(), "Dist");
fs.rmSync(distPath, {
  force: true,
  recursive: true,
});

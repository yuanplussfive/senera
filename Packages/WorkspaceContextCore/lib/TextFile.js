"use strict";

const crypto = require("node:crypto");
const fsp = require("node:fs/promises");
const chardet = require("chardet");
const iconv = require("iconv-lite");
const { isText } = require("istextorbinary");
const { toWorkspacePath } = require("./Context.js");

async function readTextFile(context, config, filePath, knownStat) {
  const stat = knownStat ?? await fsp.stat(filePath);
  if (!stat.isFile()) {
    throw new Error(`不是文件：${toWorkspacePath(context, filePath)}`);
  }
  if (stat.size > config.maxFileBytes) {
    throw new Error(`文件超过配置大小限制：${toWorkspacePath(context, filePath)}`);
  }

  const buffer = await fsp.readFile(filePath);
  if (!isText(filePath, buffer)) {
    throw new Error(`文件不是文本：${toWorkspacePath(context, filePath)}`);
  }

  const encoding = normalizeEncoding(chardet.detect(buffer));
  return {
    text: decodeBuffer(buffer, encoding),
    hash: crypto.createHash("sha256").update(buffer).digest("hex"),
    encoding,
    size: stat.size,
    mtimeMs: stat.mtimeMs
  };
}

function decodeBuffer(buffer, encoding) {
  if (encoding && iconv.encodingExists(encoding)) {
    return iconv.decode(buffer, encoding);
  }
  return buffer.toString("utf8");
}

function normalizeEncoding(value) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : "utf8";
}

function splitLines(text) {
  return String(text).split(/\r?\n/);
}

function numberedLines(lines, startLine, endLine) {
  return lines
    .slice(startLine - 1, endLine)
    .map((line, index) => `${startLine + index}: ${line}`)
    .join("\n");
}

function trimTrailingLineBreak(value) {
  return String(value).replace(/\r?\n$/, "");
}

module.exports = {
  readTextFile,
  splitLines,
  numberedLines,
  trimTrailingLineBreak
};

"use strict";

const { z } = require("@senera/tool-plugin-sdk");

const Schema = z.object({
  location: z.string().trim().min(1),
  days: z.coerce.number().int().min(1).max(7).default(1),
  language: z.string().trim().min(1).optional(),
  timeoutMs: z.coerce.number().int().min(1000).max(300000).optional()
}).strict();

module.exports = {
  Schema
};

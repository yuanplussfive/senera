"use strict";

const fs = require("node:fs");
const path = require("node:path");

function readConfigFile(context, parseTomlConfig) {
  const configPath = path.join(context.pluginRoot, context.configFileName);
  if (!fs.existsSync(configPath)) {
    throw new Error(`缺少插件配置文件：${configPath}`);
  }

  return readConfigDocument(parseTomlConfig(fs.readFileSync(configPath, "utf8")));
}

function readConfigFromToml(_context, parseTomlConfig, toml) {
  return readConfigDocument(parseTomlConfig(toml));
}

function readConfigDocument(parsed) {
  const root = readRecord(parsed.fast_context, "fast_context");
  const index = readRecord(root.index, "fast_context.index");
  const discovery = readRecord(root.discovery, "fast_context.discovery");
  const chunking = readRecord(root.chunking, "fast_context.chunking");
  const search = readRecord(root.search, "fast_context.search");
  const pathFuzzy = readRecord(root.path_fuzzy, "fast_context.path_fuzzy");
  const pathFuzzyWeights = readRecord(pathFuzzy.weights, "fast_context.path_fuzzy.weights");
  const read = readRecord(root.read, "fast_context.read");
  const scout = readOptionalRecord(root.scout, "fast_context.scout");
  const messages = readRecord(root.messages, "fast_context.messages");
  const map = readRecord(root.map, "fast_context.map");
  const weights = readRecord(search.weights, "fast_context.search.weights");
  const reasons = readRecord(search.reasons, "fast_context.search.reasons");

  const maxFileMb = readPositiveNumber(root.max_file_mb, "fast_context.max_file_mb");
  return {
    roots: readStringArray(root.roots, "fast_context.roots"),
    exclude: readStringArray(root.exclude, "fast_context.exclude"),
    maxFileMb,
    maxFileBytes: Math.max(1, Math.round(maxFileMb * 1024 * 1024)),
    max_index_files: readPositiveInteger(root.max_index_files, "fast_context.max_index_files"),
    default_max_results: readPositiveInteger(root.default_max_results, "fast_context.default_max_results"),
    default_context_lines: readNonNegativeInteger(root.default_context_lines, "fast_context.default_context_lines"),
    state_dir: readNonEmptyString(root.state_dir, "fast_context.state_dir"),
    hybrid_min_ripgrep_results: readNonNegativeInteger(root.hybrid_min_ripgrep_results, "fast_context.hybrid_min_ripgrep_results"),
    ripgrepTimeoutMs: secondsToMilliseconds(
      readPositiveNumber(root.ripgrep_timeout_seconds, "fast_context.ripgrep_timeout_seconds")
    ),
    index: {
      database: readNonEmptyString(index.database, "fast_context.index.database"),
      tokenizer: readNonEmptyString(index.tokenizer, "fast_context.index.tokenizer"),
      trigramTokenizer: readNonEmptyString(index.trigram_tokenizer, "fast_context.index.trigram_tokenizer")
    },
    discovery: {
      includeGitignore: readBoolean(discovery.include_gitignore, "fast_context.discovery.include_gitignore"),
      followSymbolicLinks: readBoolean(discovery.follow_symbolic_links, "fast_context.discovery.follow_symbolic_links"),
      excludeDisabledPlugins: readBoolean(discovery.exclude_disabled_plugins, "fast_context.discovery.exclude_disabled_plugins"),
      disabledPluginScanDepth: readNonNegativeInteger(
        discovery.disabled_plugin_scan_depth,
        "fast_context.discovery.disabled_plugin_scan_depth"
      )
    },
    chunking: {
      strategy: readNonEmptyString(chunking.strategy, "fast_context.chunking.strategy"),
      minLines: readPositiveInteger(chunking.min_lines, "fast_context.chunking.min_lines"),
      maxLines: readPositiveInteger(chunking.max_lines, "fast_context.chunking.max_lines"),
      overlapLines: readNonNegativeInteger(chunking.overlap_lines, "fast_context.chunking.overlap_lines")
    },
    search: {
      engines: readStringArray(search.engines, "fast_context.search.engines"),
      termOperator: readEnum(search.term_operator, "fast_context.search.term_operator", ["OR", "AND"]),
      collectMultiplier: readPositiveInteger(search.collect_multiplier, "fast_context.search.collect_multiplier"),
      snippetMaxLines: readPositiveInteger(search.snippet_max_lines, "fast_context.search.snippet_max_lines"),
      weights: Object.fromEntries(
        Object.entries(weights).map(([key, value]) => [key, readPositiveNumber(value, `fast_context.search.weights.${key}`)])
      ),
      reasons: Object.fromEntries(
        Object.entries(reasons).map(([key, value]) => [
          key,
          readNonEmptyString(value, `fast_context.search.reasons.${key}`)
        ])
      )
    },
    pathFuzzy: {
      maxCandidates: readPositiveInteger(pathFuzzy.max_candidates, "fast_context.path_fuzzy.max_candidates"),
      includeDirectories: readBoolean(pathFuzzy.include_directories, "fast_context.path_fuzzy.include_directories"),
      threshold: readNonNegativeNumber(pathFuzzy.threshold, "fast_context.path_fuzzy.threshold"),
      targets: readEnumArray(pathFuzzy.targets, "fast_context.path_fuzzy.targets", ["file_name", "path"]),
      weights: Object.fromEntries(
        Object.entries(pathFuzzyWeights).map(([key, value]) => [
          readEnum(key, `fast_context.path_fuzzy.weights.${key}`, ["file_name", "path"]),
          readPositiveNumber(value, `fast_context.path_fuzzy.weights.${key}`)
        ])
      )
    },
    read: {
      defaultLineWindow: readPositiveInteger(read.default_line_window, "fast_context.read.default_line_window"),
      directoryMaxChildren: readPositiveInteger(read.directory_max_children, "fast_context.read.directory_max_children"),
      directoryChildCharBudget: readPositiveInteger(read.directory_child_char_budget, "fast_context.read.directory_child_char_budget")
    },
    scout: scout ? readScoutConfig(scout) : undefined,
    messages: {
      directoryGuidance: readStringArray(messages.directory_guidance, "fast_context.messages.directory_guidance"),
      workspaceMapGuidance: readStringArray(messages.workspace_map_guidance, "fast_context.messages.workspace_map_guidance"),
      missingPathGuidance: readStringArray(messages.missing_path_guidance, "fast_context.messages.missing_path_guidance")
    },
    map: {
      markerFiles: readStringArray(map.marker_files, "fast_context.map.marker_files"),
      sourceRootNames: readStringArray(map.source_root_names, "fast_context.map.source_root_names"),
      entryPointNames: readStringArray(map.entry_point_names, "fast_context.map.entry_point_names")
    },
    analyzers: readAnalyzers(root.analyzers)
  };
}

function validateConfig(config) {
  if (config.chunking.overlapLines >= config.chunking.maxLines) {
    throw new Error("fast_context.chunking.overlap_lines 必须小于 fast_context.chunking.max_lines。");
  }
  if (config.chunking.minLines > config.chunking.maxLines) {
    throw new Error("fast_context.chunking.min_lines 必须小于或等于 fast_context.chunking.max_lines。");
  }
  if (config.analyzers.length === 0) {
    throw new Error("fast_context.analyzers 至少需要声明一个分析器。");
  }
  return config;
}

function readAnalyzers(value) {
  if (!Array.isArray(value)) {
    throw new Error("fast_context.analyzers 必须是 TOML array-of-tables。");
  }
  return value.map((entry, index) => {
    const pointer = `fast_context.analyzers[${index}]`;
    const record = readRecord(entry, pointer);
    return {
      name: readNonEmptyString(record.name, `${pointer}.name`),
      strategy: readNonEmptyString(record.strategy, `${pointer}.strategy`),
      extensions: readStringArray(record.extensions, `${pointer}.extensions`),
      symbolScope: typeof record.symbol_scope === "string"
        ? record.symbol_scope.trim()
        : undefined,
      componentNameStyle: typeof record.component_name_style === "string"
        ? record.component_name_style.trim()
        : undefined
    };
  });
}

function readScoutConfig(scout) {
  const scoutTokenizer = readRecord(scout.tokenizer, "fast_context.scout.tokenizer");
  const scoutMarkerProfile = readRecord(scout.marker_profile, "fast_context.scout.marker_profile");
  const scoutReferenceProfile = readRecord(scout.reference_profile, "fast_context.scout.reference_profile");
  const scoutLlmPlanner = readRecord(scout.llm_planner, "fast_context.scout.llm_planner");
  return {
    maxQueries: readPositiveInteger(scout.max_queries, "fast_context.scout.max_queries"),
    maxFiles: readPositiveInteger(scout.max_files, "fast_context.scout.max_files"),
    maxResultsPerQuery: readPositiveInteger(scout.max_results_per_query, "fast_context.scout.max_results_per_query"),
    contextLines: readNonNegativeInteger(scout.context_lines, "fast_context.scout.context_lines"),
    readLineWindow: readPositiveInteger(scout.read_line_window, "fast_context.scout.read_line_window"),
    bootstrapMarkers: readBoolean(scout.bootstrap_markers, "fast_context.scout.bootstrap_markers"),
    refreshIndex: readBoolean(scout.refresh_index, "fast_context.scout.refresh_index"),
    querySources: readEnumArray(scout.query_sources, "fast_context.scout.query_sources", [
      "question",
      "hints",
      "question_terms",
      "marker_files"
    ]),
    tokenizer: {
      separators: readStringArray(scoutTokenizer.separators, "fast_context.scout.tokenizer.separators"),
      minLength: readPositiveInteger(scoutTokenizer.min_length, "fast_context.scout.tokenizer.min_length"),
      maxTerms: readPositiveInteger(scoutTokenizer.max_terms, "fast_context.scout.tokenizer.max_terms"),
      caseSensitive: readBoolean(scoutTokenizer.case_sensitive, "fast_context.scout.tokenizer.case_sensitive")
    },
    markerProfile: {
      baseScore: readNonNegativeNumber(scoutMarkerProfile.base_score, "fast_context.scout.marker_profile.base_score"),
      pathMatchThreshold: readNonNegativeNumber(
        scoutMarkerProfile.path_match_threshold,
        "fast_context.scout.marker_profile.path_match_threshold"
      ),
      pathMatchWeight: readPositiveNumber(
        scoutMarkerProfile.path_match_weight,
        "fast_context.scout.marker_profile.path_match_weight"
      ),
      distinctTermWeight: readPositiveNumber(
        scoutMarkerProfile.distinct_term_weight,
        "fast_context.scout.marker_profile.distinct_term_weight"
      ),
      lineMatchWeight: readPositiveNumber(
        scoutMarkerProfile.line_match_weight,
        "fast_context.scout.marker_profile.line_match_weight"
      ),
      maxSnippets: readPositiveInteger(scoutMarkerProfile.max_snippets, "fast_context.scout.marker_profile.max_snippets"),
      sourceReason: readNonEmptyString(scoutMarkerProfile.source_reason, "fast_context.scout.marker_profile.source_reason"),
      pathReason: readNonEmptyString(scoutMarkerProfile.path_reason, "fast_context.scout.marker_profile.path_reason"),
      contentReason: readNonEmptyString(scoutMarkerProfile.content_reason, "fast_context.scout.marker_profile.content_reason"),
      pathTargets: readScoutPathTargets(scoutMarkerProfile.path_targets)
    },
    referenceProfile: {
      enabled: readBoolean(scoutReferenceProfile.enabled, "fast_context.scout.reference_profile.enabled"),
      score: readPositiveNumber(scoutReferenceProfile.score, "fast_context.scout.reference_profile.score"),
      maxScorePerPath: readPositiveNumber(
        scoutReferenceProfile.max_score_per_path,
        "fast_context.scout.reference_profile.max_score_per_path"
      ),
      maxReferences: readPositiveInteger(scoutReferenceProfile.max_references, "fast_context.scout.reference_profile.max_references"),
      maxSourceSnippets: readPositiveInteger(
        scoutReferenceProfile.max_source_snippets,
        "fast_context.scout.reference_profile.max_source_snippets"
      ),
      minLength: readPositiveInteger(scoutReferenceProfile.min_length, "fast_context.scout.reference_profile.min_length"),
      delimiters: readStringArray(scoutReferenceProfile.delimiters, "fast_context.scout.reference_profile.delimiters"),
      trimCharacters: readStringArray(scoutReferenceProfile.trim_characters, "fast_context.scout.reference_profile.trim_characters"),
      reason: readNonEmptyString(scoutReferenceProfile.reason, "fast_context.scout.reference_profile.reason")
    },
    llmPlanner: {
      enabled: readBoolean(scoutLlmPlanner.enabled, "fast_context.scout.llm_planner.enabled"),
      mode: readEnum(scoutLlmPlanner.mode, "fast_context.scout.llm_planner.mode", [
        "deterministic",
        "llm"
      ]),
      maxRounds: readPositiveInteger(scoutLlmPlanner.max_rounds, "fast_context.scout.llm_planner.max_rounds"),
      maxCommandsPerRound: readPositiveInteger(
        scoutLlmPlanner.max_commands_per_round,
        "fast_context.scout.llm_planner.max_commands_per_round"
      ),
      commandTypes: readEnumArray(scoutLlmPlanner.command_types, "fast_context.scout.llm_planner.command_types", [
        "rg",
        "readfile",
        "tree",
        "glob"
      ]),
      commandContextLines: readNonNegativeInteger(
        scoutLlmPlanner.command_context_lines,
        "fast_context.scout.llm_planner.command_context_lines"
      ),
      maxCommandResults: readPositiveInteger(
        scoutLlmPlanner.max_command_results,
        "fast_context.scout.llm_planner.max_command_results"
      ),
      maxObservationChars: readPositiveInteger(
        scoutLlmPlanner.max_observation_chars,
        "fast_context.scout.llm_planner.max_observation_chars"
      ),
      maxCandidateSummaries: readPositiveInteger(
        scoutLlmPlanner.max_candidate_summaries,
        "fast_context.scout.llm_planner.max_candidate_summaries"
      ),
      readLineWindow: readPositiveInteger(
        scoutLlmPlanner.read_line_window,
        "fast_context.scout.llm_planner.read_line_window"
      ),
      treeDepth: readPositiveInteger(scoutLlmPlanner.tree_depth, "fast_context.scout.llm_planner.tree_depth"),
      maxTreeChildren: readPositiveInteger(
        scoutLlmPlanner.max_tree_children,
        "fast_context.scout.llm_planner.max_tree_children"
      ),
      commandCandidateScore: readPositiveNumber(
        scoutLlmPlanner.command_candidate_score,
        "fast_context.scout.llm_planner.command_candidate_score"
      ),
      finalCandidateScore: readPositiveNumber(
        scoutLlmPlanner.final_candidate_score,
        "fast_context.scout.llm_planner.final_candidate_score"
      )
    }
  };
}

function readScoutPathTargets(value) {
  if (!Array.isArray(value)) {
    throw new Error("fast_context.scout.marker_profile.path_targets 必须是 TOML array-of-tables。");
  }
  const targets = value.map((entry, index) => {
    const pointer = `fast_context.scout.marker_profile.path_targets[${index}]`;
    const record = readRecord(entry, pointer);
    return {
      name: readNonEmptyString(record.name, `${pointer}.name`),
      selector: readEnum(record.selector, `${pointer}.selector`, ["basename", "path"]),
      weight: readPositiveNumber(record.weight, `${pointer}.weight`)
    };
  });
  if (targets.length === 0) {
    throw new Error("fast_context.scout.marker_profile.path_targets 不能为空。");
  }
  return targets;
}

function secondsToMilliseconds(seconds) {
  return Math.max(1, Math.round(seconds * 1000));
}

function readOptionalRecord(value, pointer) {
  if (value === undefined || value === null) {
    return undefined;
  }
  return readRecord(value, pointer);
}

function readRecord(value, pointer) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`插件配置缺少对象：${pointer}`);
  }
  return value;
}

function readStringArray(value, pointer) {
  if (!Array.isArray(value)) {
    throw new Error(`插件配置字段必须是字符串数组：${pointer}`);
  }
  const items = value.map((item) => String(item).trim()).filter(Boolean);
  if (items.length === 0) {
    throw new Error(`插件配置字段不能为空数组：${pointer}`);
  }
  return items;
}

function readNonEmptyString(value, pointer) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`插件配置字段必须是非空字符串：${pointer}`);
  }
  return value.trim();
}

function readPositiveNumber(value, pointer) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`插件配置字段必须是正数：${pointer}`);
  }
  return number;
}

function readNonNegativeNumber(value, pointer) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`插件配置字段必须是非负数：${pointer}`);
  }
  return number;
}

function readPositiveInteger(value, pointer) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`插件配置字段必须是正整数：${pointer}`);
  }
  return number;
}

function readNonNegativeInteger(value, pointer) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`插件配置字段必须是非负整数：${pointer}`);
  }
  return number;
}

function readBoolean(value, pointer) {
  if (typeof value !== "boolean") {
    throw new Error(`插件配置字段必须是布尔值：${pointer}`);
  }
  return value;
}

function readEnum(value, pointer, allowed) {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`插件配置字段 ${pointer} 必须是：${allowed.join(", ")}。`);
  }
  return value;
}

function readEnumArray(value, pointer, allowed) {
  if (!Array.isArray(value)) {
    throw new Error(`插件配置字段必须是字符串数组：${pointer}`);
  }
  const items = value.map((item, index) => readEnum(item, `${pointer}[${index}]`, allowed));
  if (items.length === 0) {
    throw new Error(`插件配置字段不能为空数组：${pointer}`);
  }
  return items;
}

module.exports = {
  readConfig: (context, parseTomlConfig) => validateConfig(readConfigFile(context, parseTomlConfig)),
  readConfigFromToml: (context, parseTomlConfig, toml) =>
    validateConfig(readConfigFromToml(context, parseTomlConfig, toml))
};

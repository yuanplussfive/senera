import { describe, expect, test, vi } from "vitest";
import { AgentToolSearchTokenizer } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchTokenizer.js";
import {
  capabilityFacetEntries,
  capabilityRiskText,
  capabilitySearchText,
  matchToolCapabilities,
} from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchCapabilities.js";
import { AgentToolSearchIndex } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchIndex.js";
import {
  AgentToolSearchDocumentBuilder,
  resolveAgentToolSearchSources,
  resolveAgentToolSearchDescription,
  resolveAgentToolSearchTitle,
} from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchDocumentBuilder.js";
import type {
  AgentToolSearchOptions,
  AgentToolSearchResult,
  ToolSearchDocument,
} from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchTypes.js";
import type { AgentToolSearchRegistryReader } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchIndex.js";
import type { AgentCapabilitySearchIndex } from "../../../Source/AgentSystem/ToolSearch/AgentCapabilitySearchIndex.js";
import type { RegisteredTool } from "../../../Source/AgentSystem/Types/AgentToolRuntimeTypes.js";
import type { ResolvedAgentToolSearchConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import { AgentToolResourceCapabilityIds } from "../../../Source/AgentSystem/ToolRuntime/AgentToolResourceCapabilityIds.js";
import { createAgentToolCatalogIdentity } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchRuntimeCatalog.js";
import {
  AgentToolResourceQueryShapes,
  type AgentToolResourceDiscoveryReader,
  type AgentToolResourceQueryShape,
} from "../../../Source/AgentSystem/ToolRuntime/AgentToolResourceDiscovery.js";

describe("ToolSearch core", () => {
  test("does not rank a lone CJK segmentation fragment as independent capability evidence", async () => {
    const focused = createTool({
      name: "WorkspaceVerification",
      title: "验证工作区插件协议",
      summary: "检查工作区插件协议并运行验证。",
      tags: ["检查", "插件", "协议", "运行", "验证"],
      actions: ["inspect", "verify"],
      targets: ["workspace", "plugin"],
      priority: 10,
    });
    const fragmentOnly = createTool({
      name: "FragmentOnly",
      title: "区",
      summary: "区",
      tags: ["区"],
      actions: [],
      targets: [],
      priority: 20,
    });
    const index = new AgentToolSearchIndex(createRegistry([focused, fragmentOnly]), createToolSearchConfig());

    const results = await allDiscoveryResults(index, { query: "检查当前工作区的插件协议并运行验证" });

    expect(results.map((result) => result.toolName)).toEqual(["WorkspaceVerification"]);
    expect(results[0]?.matchedTerms).not.toContain("区");
  });

  test("reuses rerank document features across repeated searches", async () => {
    const index = new AgentToolSearchIndex(
      createRegistry([
        createTool({
          name: "StaticFeatureTool",
          title: "Static feature inspection",
          summary: "Inspect a stable capability declaration.",
          tags: ["static", "feature", "inspect"],
          actions: ["inspect"],
          targets: ["capability"],
          priority: 10,
        }),
        createTool({
          name: "ComparisonTool",
          title: "Comparison capability",
          summary: "Inspect another capability declaration.",
          tags: ["comparison", "inspect"],
          actions: ["inspect"],
          targets: ["capability"],
          priority: 20,
        }),
      ]),
      createToolSearchConfig(),
    );
    const tokenize = vi.spyOn(AgentToolSearchTokenizer.prototype, "tokenizeContent");

    try {
      await allDiscoveryResults(index, { query: "inspect static feature" });
      const initialCalls = tokenize.mock.calls.length;
      tokenize.mockClear();
      await allDiscoveryResults(index, { query: "inspect static feature" });

      expect(initialCalls).toBeGreaterThan(0);
      expect(tokenize.mock.calls.length).toBeLessThan(initialCalls);
    } finally {
      tokenize.mockRestore();
    }
  });

  test("matches capability facets and projects risk text", () => {
    const tokenizer = new AgentToolSearchTokenizer();
    const capability = {
      Id: "workspace.read",
      Title: "Read workspace files",
      Description: "Inspect project files",
      Facets: {
        Actions: ["read", "inspect"],
        Targets: ["workspace", "file"],
      },
      Aliases: ["open file"],
      Risk: {
        SideEffect: "none",
        Permission: "read",
        Notes: ["no writes"],
      },
    };
    const doc = {
      toolName: "WorkspaceReadFile",
      title: "Read file",
      ownerName: "workspace",
      ownerTitle: "Workspace",
      sourceText: "workspace Workspace Files and source code in the current workspace.",
      sourceIds: ["workspace"],
      sources: [
        {
          id: "workspace",
          title: "Workspace",
          description: "Files and source code in the current workspace.",
        },
      ],
      tags: "workspace read",
      summary: "Read files",
      whenToUse: "Inspect workspace files",
      examples: "",
      avoid: "",
      capabilityText: capabilitySearchText(capability, { includeRisk: false }),
      capabilityFacets: "read inspect workspace file",
      capabilityRiskText: capabilityRiskText(capability.Risk),
      params: "path",
      identityPhrases: ["WorkspaceReadFile", "Read file", "workspace.read", "Read workspace files", "open file"],
      permissions: "workspace.read",
      priority: 10,
      anchorText: "WorkspaceReadFile Read file read workspace file",
      coreText: "WorkspaceReadFile read workspace file",
      id: "workspace-read",
      capabilities: [capability],
    } satisfies ToolSearchDocument;

    expect(capabilityFacetEntries(capability.Facets)).toEqual([
      { name: "Actions", values: ["read", "inspect"] },
      { name: "Targets", values: ["workspace", "file"] },
    ]);
    expect(capabilityRiskText(capability.Risk)).toBe("none read no writes");
    expect(matchToolCapabilities(doc, tokenizer.tokenize("read workspace"), tokenizer)).toEqual([
      {
        id: "workspace.read",
        title: "Read workspace files",
        score: expect.any(Number),
        matchedFacets: ["Actions", "Targets"],
        risk: {
          sideEffect: "none",
          permission: "read",
        },
      },
    ]);
  });

  test("indexes registered tools and ranks by capability without score coupling", async () => {
    const index = new AgentToolSearchIndex(
      createRegistry([
        createTool({
          name: "WorkspaceReadFile",
          title: "Read file",
          summary: "Read project files from the workspace",
          tags: ["workspace", "read"],
          actions: ["read"],
          targets: ["workspace", "file"],
          priority: 10,
        }),
        createTool({
          name: "WeatherTool",
          title: "Weather",
          summary: "Fetch weather forecast",
          tags: ["weather"],
          actions: ["forecast"],
          targets: ["weather", "city"],
          priority: 50,
          sourceId: "web",
        }),
      ]),
      createToolSearchConfig(),
    );

    const results = await allDiscoveryResults(index, {
      query: "read workspace file",
    });

    expect(index.getToolNames()).toEqual(["WorkspaceReadFile", "WeatherTool"]);
    expect(results[0]?.toolName).toBe("WorkspaceReadFile");
    expect(results[0]?.matchedCapabilities[0]?.matchedFacets).toContain("Actions");
    expect(results.map((result) => result.toolName)).not.toContain("WeatherTool");
  });

  test("keeps an extension owner label out of sibling tool identities", async () => {
    const checkpoint = createTool({
      name: "WorkspaceRestoreCheckpoint",
      title: "Restore workspace checkpoint",
      summary: "Restore a durable workspace snapshot.",
      tags: ["checkpoint", "restore"],
      actions: ["restore"],
      targets: ["workspace", "checkpoint"],
      priority: 1,
    });
    const verify = createTool({
      name: "ExtensionVerificationRun",
      title: "Run extension verification",
      summary: "Run the plugin protocol validation command.",
      tags: ["plugin", "protocol", "validation"],
      actions: ["run", "verify"],
      targets: ["extension", "test-suite"],
      priority: 10,
    });
    // Both tools belong to one extension. Its display label is deliberately
    // broad and must not become an identity phrase for either operation.
    checkpoint.owner = { ...checkpoint.owner, title: "Plugin protocol validation" };
    verify.owner = { ...verify.owner, title: "Plugin protocol validation" };

    const builder = new AgentToolSearchDocumentBuilder();
    expect(resolveAgentToolSearchTitle(checkpoint)).toBe("Restore workspace checkpoint");
    expect(builder.build(checkpoint).title).toBe("Restore workspace checkpoint");
    expect(builder.build(verify).title).toBe("Run extension verification");

    await expect(
      actionableDiscoveryResults(
        new AgentToolSearchIndex(createRegistry([checkpoint, verify]), createToolSearchConfig()),
        {
          query: "plugin protocol validation",
        },
      ),
    ).resolves.toEqual([expect.objectContaining({ toolName: "ExtensionVerificationRun" })]);
  });

  test("uses producer-authored discovery descriptions without a title fallback", () => {
    const summaryTool = createTool({
      name: "WorkspaceReadFile",
      title: "Internal read label",
      summary: "Read a known workspace file as text or structured data.",
      tags: ["workspace", "read"],
      actions: ["read"],
      targets: ["file"],
      priority: 1,
    });
    const capabilityOnlyTool = createTool({
      name: "WorkspaceSearchFiles",
      title: "Internal search label",
      summary: "Unused fixture summary",
      tags: ["workspace", "search"],
      actions: ["search"],
      targets: ["file"],
      priority: 1,
    });
    capabilityOnlyTool.search = {
      ...capabilityOnlyTool.search,
      Summary: " ",
      Capabilities: [
        {
          Id: "WorkspaceSearchFiles.content",
          Description: "Find matching text across workspace files.",
        },
        {
          Id: "WorkspaceSearchFiles.duplicate",
          Description: "Find matching text across workspace files.",
        },
      ],
    };
    const undocumentedTool = { ...capabilityOnlyTool, search: { Capabilities: [] } };

    expect(resolveAgentToolSearchDescription(summaryTool)).toBe(summaryTool.search?.Summary);
    expect(resolveAgentToolSearchDescription(capabilityOnlyTool)).toBe("Find matching text across workspace files.");
    expect(() => resolveAgentToolSearchDescription(undocumentedTool)).toThrow(
      "must declare search.Summary or at least one search capability Description",
    );
  });

  test("derives a stable disclosure source from registration provenance when a producer omits sources", () => {
    const hostTool = createTool({
      name: "WorkspaceReadFile",
      title: "Read workspace file",
      summary: "Read workspace files.",
      tags: ["workspace", "read"],
      actions: ["read"],
      targets: ["file"],
      priority: 1,
    });
    hostTool.owner = { ...hostTool.owner, kind: "system" };
    hostTool.sources = [];

    expect(resolveAgentToolSearchSources(hostTool)).toEqual([
      {
        id: "system:WorkspaceReadFile-owner",
        title: "Read workspace file",
        description: "Read workspace files.",
      },
    ]);

    const mcpTool = {
      ...hostTool,
      owner: { ...hostTool.owner, name: "weather-server", kind: "mcp" as const },
      handler: {
        kind: "McpTool" as const,
        server: {
          id: "weather-server",
          packageName: "weather-package",
          revision: "1",
          transport: "http" as const,
          url: "https://example.test/mcp",
        },
        tool: "forecast",
        readOnly: true,
      },
      sources: [],
    };

    expect(resolveAgentToolSearchSources(mcpTool)).toEqual([
      {
        id: "mcp:weather-package/weather-server",
        title: "weather-package/weather-server",
        description: "Read workspace files.",
      },
    ]);
    expect(new AgentToolSearchDocumentBuilder().build(mcpTool).sourceIds).toEqual([
      "mcp:weather-package/weather-server",
    ]);
  });

  test("does not let a Han segmentation fragment become a lexical-intent anchor", async () => {
    const patch = createTool({
      name: "WorkspacePatch",
      title: "Apply workspace patch",
      summary: "验证受影响的配置。",
      tags: ["工作区"],
      actions: ["patch"],
      targets: ["workspace", "configuration"],
      priority: 1,
    });
    const verify = createTool({
      name: "ExtensionVerificationRun",
      title: "Run extension verification",
      summary: "运行插件协议验证。",
      tags: ["插件", "协议", "验证"],
      actions: ["run", "verify"],
      targets: ["extension", "test-suite"],
      priority: 10,
    });

    const discovery = await new AgentToolSearchIndex(
      createRegistry([patch, verify]),
      createToolSearchConfig(),
    ).discoverHybrid({
      query: "检查当前工作区的插件协议并运行验证",
    });

    expect(discovery.match).toEqual([]);
    expect(discovery.maybe).toEqual(
      expect.arrayContaining([expect.objectContaining({ toolName: "ExtensionVerificationRun" })]),
    );
  });

  test("routes a complete producer-declared usage example without making its words generic aliases", async () => {
    const shell = createTool({
      name: "ShellRunner",
      title: "Shell runner",
      summary: "Execute typed shell commands.",
      tags: ["shell"],
      actions: ["execute"],
      targets: ["process"],
      examples: ["node --version"],
      priority: 10,
    });
    const workspace = createTool({
      name: "WorkspaceReader",
      title: "Workspace reader",
      summary: "Read workspace files.",
      tags: ["workspace"],
      actions: ["read"],
      targets: ["file"],
      priority: 20,
    });
    const index = new AgentToolSearchIndex(createRegistry([shell, workspace]), createToolSearchConfig());

    const exact = await actionableDiscoveryResults(index, { query: "node --version" });
    const prose = await actionableDiscoveryResults(index, { query: "explain the node version" });

    expect(exact).toEqual([
      expect.objectContaining({ toolName: "ShellRunner", ranks: expect.objectContaining({ example: 1 }) }),
    ]);
    expect(prose).not.toEqual(expect.arrayContaining([expect.objectContaining({ toolName: "ShellRunner" })]));
  });

  test("includes declared resources in the content-addressed catalog identity", () => {
    const tool = createTool({
      name: "WorkspaceReadFile",
      title: "Read workspace file",
      summary: "Read project files from the workspace.",
      tags: ["workspace", "read"],
      actions: ["read"],
      targets: ["workspace", "file"],
      priority: 10,
    });
    const withoutResource = createAgentToolCatalogIdentity([tool], ["Local"]);
    const withResource = {
      ...tool,
      handler: {
        ...tool.handler,
        resources: [
          {
            Capability: AgentToolResourceCapabilityIds.WorkspacePath,
            Pointer: "/path",
            Parameters: { Intent: "read" },
          },
        ],
      },
    };

    expect(createAgentToolCatalogIdentity([withResource], ["Local"])).not.toBe(withoutResource);
  });

  test("changes catalog identity when execution policy fields change", () => {
    const tool = createTool({
      name: "WorkspaceReadFile",
      title: "Read workspace file",
      summary: "Read project files.",
      tags: ["workspace", "read"],
      actions: ["read"],
      targets: ["file"],
      priority: 1,
    });
    const baseline = createAgentToolCatalogIdentity([tool], ["Local"]);
    const changes: Array<[string, (value: RegisteredTool) => RegisteredTool]> = [
      ["permissions", (value) => ({ ...value, permissions: ["workspace.read"] })],
      ["handler", (value) => ({ ...value, handler: { ...value.handler, capability: "changed" } })],
      ["execution", (value) => ({ ...value, execution: { ...value.execution, Workspace: "ReadWrite" } })],
      ["runtime", (value) => ({ ...value, runtime: { ...value.runtime, Lifecycle: "Persistent" } })],
      ["approval", (value) => ({ ...value, approval: { Mode: "ask", Reason: "test" } })],
      ["child grant", (value) => ({ ...value, childGrant: "internal" })],
    ];
    for (const [field, change] of changes) {
      expect(createAgentToolCatalogIdentity([change(tool)], ["Local"]), field).not.toBe(baseline);
    }
  });

  test("keeps complete lexical evidence ahead of a semantic neighbor while preserving semantic rank", async () => {
    const semanticEvidence = [
      { name: "CommandVerifier", score: 0.758 },
      { name: "CheckpointInspector", score: 0.661 },
    ];
    const capabilityIndex = {
      lexical: () => [],
      fuzzy: () => [],
      semantic: async () => semanticEvidence,
    } as unknown as AgentCapabilitySearchIndex;
    const index = new AgentToolSearchIndex(
      createRegistry([
        createTool({
          name: "CheckpointInspector",
          title: "Inspect workspace checkpoint",
          summary: "Inspect workspace verification state before restoring a checkpoint",
          tags: ["inspect", "workspace", "verification"],
          actions: ["restore"],
          targets: ["workspace", "checkpoint"],
          priority: 1,
        }),
        createTool({
          name: "CommandVerifier",
          title: "Run verification command",
          summary: "Run a command and report verification output",
          tags: ["run", "verification"],
          actions: ["run", "verify"],
          targets: ["process", "test-suite"],
          priority: 100,
        }),
      ]),
      createToolSearchConfig(),
      capabilityIndex,
    );

    const results = await allDiscoveryResults(index, {
      query: "inspect workspace verification",
    });

    expect(results.map((result) => result.toolName)).toEqual(["CheckpointInspector", "CommandVerifier"]);
    expect(results[1]).toMatchObject({ toolName: "CommandVerifier", semanticScore: 0.758 });
  });

  test("uses semantic ranking to resolve a partial lexical anchor without weakening pure-vector admission", async () => {
    const doctor = createTool({
      name: "DesktopDoctor",
      title: "检查运行环境",
      summary: "检查并运行桌面环境诊断。",
      tags: ["检查", "运行", "桌面"],
      actions: ["inspect", "run"],
      targets: ["desktop", "environment"],
      priority: 10,
    });
    // This aliases a concrete onboarding operation. Its two action terms are
    // deliberately present in the request below, but the full alias is not.
    // It must remain a partial lexical candidate rather than a direct route.
    doctor.search!.Capabilities![0]!.Aliases = ["首次运行检查"];
    const shell = createTool({
      name: "ShellCommandTool",
      title: "执行验证命令",
      summary: "在工作区运行验证命令。",
      tags: ["执行", "验证", "命令"],
      actions: ["execute", "verify"],
      targets: ["process", "command"],
      priority: 20,
    });
    const checkpoint = createTool({
      name: "WorkspaceRestoreCheckpoint",
      title: "恢复工作区检查点",
      summary: "恢复先前的工作区快照。",
      tags: ["恢复", "工作区", "检查点"],
      actions: ["restore"],
      targets: ["workspace", "checkpoint"],
      priority: 30,
    });
    const config = createToolSearchConfig();
    config.Embedding.Enabled = true;
    let semanticCalls = 0;
    const capabilityIndex = {
      lexical: () => [
        {
          name: "DesktopDoctor",
          score: 1,
          queryTerms: ["检查", "运行"],
          matchedFields: {},
        },
      ],
      fuzzy: () => [],
      semantic: async () => {
        semanticCalls += 1;
        return [
          { name: "ShellCommandTool", score: 0.748 },
          // The lexical anchor makes the nearby semantic candidate useful for
          // one shared comparison, even without an absolute cosine threshold.
          { name: "WorkspaceRestoreCheckpoint", score: 0.69 },
          { name: "DesktopDoctor", score: 0.65 },
        ];
      },
    } as unknown as AgentCapabilitySearchIndex;
    const index = new AgentToolSearchIndex(createRegistry([doctor, shell, checkpoint]), config, capabilityIndex);

    const discovery = await index.discoverHybrid({ query: "检查当前工作区的插件协议并运行验证" });

    expect(semanticCalls).toBe(1);
    expect(discovery.match).toEqual([]);
    expect(discovery.maybe).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ toolName: "ShellCommandTool", semanticScore: 0.748 }),
        expect.objectContaining({ toolName: "DesktopDoctor" }),
      ]),
    );
  });

  test("uses semantic evidence to resolve two close declared visual capabilities", async () => {
    const screenshot = createTool({
      name: "BrowserScreenshot",
      title: "Capture browser screenshot",
      summary: "Capture the current browser page as an image.",
      tags: ["browser", "screenshot"],
      actions: ["capture"],
      targets: ["browser-page"],
      aliases: ["截图"],
      priority: 20,
    });
    const imageAnalyze = createTool({
      name: "ImageAnalyze",
      title: "Analyze an image",
      summary: "Analyze image content and extract visible text.",
      tags: ["image", "analysis", "screenshot"],
      actions: ["analyze"],
      targets: ["image"],
      aliases: ["分析图片", "识别图片", "分析截图"],
      priority: 10,
    });
    let semanticCalls = 0;
    const capabilityIndex = {
      lexical: () => [
        { name: "ImageAnalyze", score: 1, queryTerms: ["分析", "截图"], matchedFields: {} },
        { name: "BrowserScreenshot", score: 0.99, queryTerms: ["截图"], matchedFields: {} },
      ],
      fuzzy: () => [
        { name: "ImageAnalyze", score: 2 },
        { name: "BrowserScreenshot", score: 1.9 },
      ],
      semantic: async () => {
        semanticCalls += 1;
        return [
          { name: "ImageAnalyze", score: 0.78 },
          { name: "BrowserScreenshot", score: 0.61 },
        ];
      },
    } as unknown as AgentCapabilitySearchIndex;
    const index = new AgentToolSearchIndex(
      createRegistry([screenshot, imageAnalyze]),
      createToolSearchConfig(),
      capabilityIndex,
    );

    const discovery = await index.discoverHybrid({ query: "分析这张截图" });

    expect(semanticCalls).toBe(1);
    expect(discovery.match).toEqual([expect.objectContaining({ toolName: "ImageAnalyze" })]);
    expect(discovery.maybe).toEqual(
      expect.arrayContaining([expect.objectContaining({ toolName: "BrowserScreenshot" })]),
    );
  });

  test("expands an ambiguous lexical race only across the current semantic score band", async () => {
    const primary = createTool({
      name: "PrimaryInspector",
      title: "Primary inspector",
      summary: "Inspect visual input.",
      tags: ["inspect", "visual"],
      actions: ["inspect"],
      targets: ["image"],
      priority: 10,
    });
    const secondary = createTool({
      name: "SecondaryInspector",
      title: "Secondary inspector",
      summary: "Inspect visual input with a second strategy.",
      tags: ["inspect", "visual"],
      actions: ["inspect"],
      targets: ["image"],
      priority: 20,
    });
    const semanticNeighbor = createTool({
      name: "SemanticNeighbor",
      title: "Semantic neighbor",
      summary: "Classify visual input.",
      tags: ["classify"],
      actions: ["classify"],
      targets: ["image"],
      priority: 30,
    });
    const distantNeighbor = createTool({
      name: "DistantNeighbor",
      title: "Distant neighbor",
      summary: "Inspect a workspace state.",
      tags: ["workspace"],
      actions: ["inspect"],
      targets: ["workspace"],
      priority: 40,
    });
    const config = createToolSearchConfig();
    config.Embedding.Enabled = true;
    const capabilityIndex = {
      lexical: () => [
        { name: primary.name, score: 1, queryTerms: ["inspect", "visual"], matchedFields: {} },
        { name: secondary.name, score: 0.99, queryTerms: ["inspect", "visual"], matchedFields: {} },
      ],
      fuzzy: () => [],
      semantic: async () => [
        { name: primary.name, score: 0.8 },
        { name: secondary.name, score: 0.79 },
        { name: semanticNeighbor.name, score: 0.76 },
        { name: distantNeighbor.name, score: 0.5 },
      ],
    } as unknown as AgentCapabilitySearchIndex;
    const index = new AgentToolSearchIndex(
      createRegistry([primary, secondary, semanticNeighbor, distantNeighbor]),
      config,
      capabilityIndex,
    );

    const discovery = await index.discoverHybrid({ query: "inspect visual" });

    expect(discovery.match).toEqual([]);
    expect(discovery.maybe).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ toolName: primary.name }),
        expect.objectContaining({ toolName: secondary.name }),
        expect.objectContaining({ toolName: semanticNeighbor.name }),
      ]),
    );
  });

  test("does not let a semantic typo neighbour replace a reliable command candidate", async () => {
    const shell = createTool({
      name: "ShellCommandTool",
      title: "Run a shell command",
      summary: "Run tests and other explicitly typed shell commands.",
      tags: ["shell", "npm", "test"],
      actions: ["run"],
      targets: ["command"],
      priority: 10,
    });
    const terminal = createTool({
      name: "TerminalStartTool",
      title: "Start an interactive terminal",
      summary: "Start an interactive PTY-backed terminal.",
      tags: ["terminal", "interactive"],
      actions: ["start"],
      targets: ["pty"],
      priority: 20,
    });
    let semanticCalls = 0;
    const capabilityIndex = {
      lexical: () => [{ name: "ShellCommandTool", score: 1, queryTerms: ["npm"], matchedFields: {} }],
      fuzzy: () => [
        { name: "ShellCommandTool", score: 1.5 },
        { name: "TerminalStartTool", score: 1.4 },
      ],
      semantic: async () => {
        semanticCalls += 1;
        return [
          { name: "TerminalStartTool", score: 0.62 },
          { name: "ShellCommandTool", score: 0.4 },
        ];
      },
    } as unknown as AgentCapabilitySearchIndex;
    const index = new AgentToolSearchIndex(
      createRegistry([shell, terminal]),
      createToolSearchConfig(),
      capabilityIndex,
    );

    const discovery = await index.discoverHybrid({ query: "npm tes" });

    expect(semanticCalls).toBe(1);
    expect(discovery.match).toEqual([]);
    expect(discovery.maybe[0]).toMatchObject({ toolName: "ShellCommandTool" });
  });

  test("rejects a low-confidence pure semantic nearest neighbour", async () => {
    const guide = createTool({
      name: "ToolGuide",
      title: "Tool guide",
      summary: "Explain the available tools.",
      tags: ["guide"],
      actions: ["explain"],
      targets: ["tools"],
      priority: 10,
    });
    const desktop = createTool({
      name: "DesktopTool",
      title: "Desktop helper",
      summary: "Inspect desktop applications.",
      tags: ["desktop"],
      actions: ["inspect"],
      targets: ["application"],
      priority: 20,
    });
    const config = createToolSearchConfig();
    let semanticCalls = 0;
    const capabilityIndex = {
      lexical: () => [],
      fuzzy: () => [],
      semantic: async () => {
        semanticCalls += 1;
        return [
          { name: "DesktopTool", score: 0.371 },
          { name: "ToolGuide", score: 0.352 },
        ];
      },
    } as unknown as AgentCapabilitySearchIndex;
    const index = new AgentToolSearchIndex(createRegistry([guide, desktop]), config, capabilityIndex);

    await expect(actionableDiscoveryResults(index, { query: "请用一句话说明你是谁" })).resolves.toEqual([]);
    expect(semanticCalls).toBe(1);
  });

  test("keeps a gradual pure-semantic tail as possibilities instead of inventing a match", async () => {
    const tools = [
      createTool({
        name: "BroadCandidate",
        title: "Broad candidate",
        summary: "A broad capability association.",
        tags: ["broad"],
        actions: ["inspect"],
        targets: ["generic"],
        priority: 10,
      }),
      createTool({
        name: "NearbyCandidate",
        title: "Nearby candidate",
        summary: "A nearby capability association.",
        tags: ["nearby"],
        actions: ["inspect"],
        targets: ["generic"],
        priority: 20,
      }),
      createTool({
        name: "TailCandidate",
        title: "Tail candidate",
        summary: "A weaker capability association.",
        tags: ["tail"],
        actions: ["inspect"],
        targets: ["generic"],
        priority: 30,
      }),
    ];
    const config = createToolSearchConfig();
    const capabilityIndex = {
      lexical: () => [],
      fuzzy: () => [],
      semantic: async () => [
        { name: "BroadCandidate", score: 0.53 },
        { name: "NearbyCandidate", score: 0.49 },
        { name: "TailCandidate", score: 0.41 },
      ],
    } as unknown as AgentCapabilitySearchIndex;
    const index = new AgentToolSearchIndex(createRegistry(tools), config, capabilityIndex);

    const discovery = await index.discoverHybrid({ query: "long form creative writing request" });

    expect(discovery.match).toEqual([]);
    expect(discovery.maybe).toEqual(expect.arrayContaining([expect.objectContaining({ toolName: "BroadCandidate" })]));
  });

  test("does not promote a low-score fuzzy neighbour during pure semantic recovery", async () => {
    const image = createTool({
      name: "ImageGenerator",
      title: "Image generator",
      summary: "Create artwork from a prompt.",
      tags: ["image"],
      actions: ["create"],
      targets: ["image"],
      priority: 10,
    });
    const unrelated = createTool({
      name: "WorkspaceReader",
      title: "Workspace reader",
      summary: "Read files from the workspace.",
      tags: ["workspace"],
      actions: ["read"],
      targets: ["file"],
      priority: 20,
    });
    const config = createToolSearchConfig();
    config.Embedding.Enabled = true;
    const capabilityIndex = {
      lexical: () => [],
      fuzzy: () => [
        { name: image.name, score: 1.2 },
        { name: unrelated.name, score: 1.1 },
      ],
      semantic: async () => [
        { name: image.name, score: 0.42 },
        { name: unrelated.name, score: 0.4 },
      ],
    } as unknown as AgentCapabilitySearchIndex;
    const index = new AgentToolSearchIndex(createRegistry([image, unrelated]), config, capabilityIndex);

    await expect(actionableDiscoveryResults(index, { query: "这两天有什么新进展" })).resolves.toEqual([]);
  });

  test("keeps semantic evidence fused with a complete lexical request", async () => {
    const shell = createTool({
      name: "ShellCommandTool",
      title: "运行 npm test",
      summary: "运行 npm test 命令。",
      tags: ["运行", "npm", "test"],
      actions: ["run"],
      targets: ["process", "command"],
      priority: 10,
    });
    let semanticCalls = 0;
    const capabilityIndex = {
      lexical: () => [
        {
          name: "ShellCommandTool",
          score: 1,
          queryTerms: ["运行", "npm", "test"],
          matchedFields: {},
        },
      ],
      fuzzy: () => [],
      semantic: async () => {
        semanticCalls += 1;
        return [{ name: "ShellCommandTool", score: 1 }];
      },
    } as unknown as AgentCapabilitySearchIndex;
    const index = new AgentToolSearchIndex(createRegistry([shell]), createToolSearchConfig(), capabilityIndex);

    await expect(actionableDiscoveryResults(index, { query: "运行 npm test" })).resolves.toEqual([
      expect.objectContaining({ toolName: "ShellCommandTool" }),
    ]);
    expect(semanticCalls).toBe(1);
  });

  test("fuses learned evidence without displacing stronger lexical coverage", async () => {
    const index = new AgentToolSearchIndex(
      createRegistry([
        createTool({
          name: "WorkspaceReadFile",
          title: "Read file",
          summary: "Read project files from the workspace",
          tags: ["workspace", "read"],
          actions: ["read"],
          targets: ["workspace", "file"],
          priority: 10,
        }),
        createTool({
          name: "WeatherTool",
          title: "Weather",
          summary: "Fetch weather forecast",
          tags: ["weather"],
          actions: ["forecast"],
          targets: ["weather", "city"],
          priority: 50,
          sourceId: "web",
        }),
      ]),
      createToolSearchConfig(),
    );
    const learnedWeather = {
      toolName: "WeatherTool",
      evidence: 4,
      confidence: 0.9,
      rankScore: 1,
      signals: [
        {
          term: "meteorology-alias",
          source: "toolLearning.trigger",
          support: 4,
          confidence: 0.9,
          score: 4,
          lastSeenAt: 1,
        },
      ],
    };

    const lexical = await allDiscoveryResults(index, {
      query: "read workspace file",
      memoryEvidence: [learnedWeather],
    });
    const memoryOnly = await allDiscoveryResults(index, {
      query: "meteorology-alias",
      memoryEvidence: [learnedWeather],
    });
    const weakMemoryOnly = await allDiscoveryResults(index, {
      query: "weak-alias",
      memoryEvidence: [{ ...learnedWeather, evidence: 2, confidence: 0.79 }],
    });

    expect(lexical[0]).toMatchObject({ toolName: "WorkspaceReadFile" });
    expect(lexical).toEqual(expect.arrayContaining([expect.objectContaining({ toolName: "WeatherTool" })]));
    expect(memoryOnly.map((result) => result.toolName)).toEqual(["WeatherTool"]);
    expect(weakMemoryOnly).toEqual([expect.objectContaining({ toolName: "WeatherTool" })]);
  });

  test("uses declared resource shape for admission while action evidence determines file-path ordering", async () => {
    const read = createTool({
      name: "WorkspaceReadFile",
      title: "Read workspace file",
      summary: "读取工作区中的文本文件",
      tags: ["workspace", "file", "read"],
      actions: ["read"],
      targets: ["workspace-file", "text-file"],
      priority: 10,
    });
    read.handler = {
      ...read.handler,
      resources: [{ Capability: "senera.workspace.path", Pointer: "/path", Parameters: { Intent: "read" } }],
    };
    const write = createTool({
      name: "WorkspacePatchFile",
      title: "Modify workspace file",
      summary: "修改工作区中的文件",
      tags: ["workspace", "file", "edit"],
      actions: ["edit"],
      targets: ["workspace-file"],
      priority: 20,
    });
    write.handler = {
      ...write.handler,
      resources: [{ Capability: "senera.workspace.path", Pointer: "/path", Parameters: { Intent: "replace" } }],
    };

    const results = await actionableDiscoveryResults(
      new AgentToolSearchIndex(
        // Register the mutation first to prove that structural admission never
        // makes registration order outrank the request's declared operation.
        createRegistry([write, read]),
        createToolSearchConfig(),
        undefined,
        resourceDiscovery({ [AgentToolResourceCapabilityIds.WorkspacePath]: [AgentToolResourceQueryShapes.Path] }),
      ),
      {
        query: "读取 package.json",
      },
    );

    expect(results.map((result) => result.toolName)).toEqual(["WorkspaceReadFile"]);
  });

  test("uses resource discovery declarations instead of capability ID suffixes", async () => {
    const read = createTool({
      name: "WorkspaceReadFile",
      title: "Read workspace file",
      summary: "Read a workspace file.",
      tags: ["workspace", "file", "read"],
      actions: ["read"],
      targets: ["workspace-file"],
      priority: 10,
    });
    read.handler = {
      ...read.handler,
      resources: [{ Capability: "example.custom.path", Pointer: "/path", Parameters: { Intent: "read" } }],
    };

    const withoutDeclaration = new AgentToolSearchIndex(createRegistry([read]), createToolSearchConfig());
    const withDeclaration = new AgentToolSearchIndex(
      createRegistry([read]),
      createToolSearchConfig(),
      undefined,
      resourceDiscovery({ "example.custom.path": [AgentToolResourceQueryShapes.Path] }),
    );

    await expect(actionableDiscoveryResults(withoutDeclaration, { query: "package.json" })).resolves.toEqual([]);
    await expect(actionableDiscoveryResults(withDeclaration, { query: "package.json" })).resolves.toEqual([
      expect.objectContaining({ toolName: "WorkspaceReadFile" }),
    ]);
  });

  test("does not turn broad avoid prose into a structural routing veto", async () => {
    const patch = createTool({
      name: "WorkspaceApplyPatch",
      title: "Apply workspace patch",
      summary: "修改工作区文件。",
      tags: ["文件编辑", "代码修改"],
      actions: ["edit", "patch"],
      targets: ["workspace", "file"],
      priority: 10,
    });
    patch.handler = {
      ...patch.handler,
      resources: [{ Capability: "senera.workspace.path", Pointer: "/operations", Parameters: { Intent: "replace" } }],
    };
    patch.search = {
      ...patch.search,
      Avoid: ["不知道已有文件内容时先读取文件。"],
    };
    const index = new AgentToolSearchIndex(
      createRegistry([patch]),
      createToolSearchConfig(),
      undefined,
      resourceDiscovery({ [AgentToolResourceCapabilityIds.WorkspacePath]: [AgentToolResourceQueryShapes.Path] }),
    );

    expect(
      (await actionableDiscoveryResults(index, { query: "修改 Source/AgentSystem 文件" })).map(
        (result) => result.toolName,
      ),
    ).toEqual(["WorkspaceApplyPatch"]);
  });

  test("does not promote incidental parameter prose into a tool recommendation", async () => {
    const keyPress = createTool({
      name: "BrowserPress",
      title: "Press browser key",
      summary: "Send a key sequence to the controlled browser.",
      tags: ["browser", "key"],
      actions: ["press"],
      targets: ["browser-page"],
      priority: 10,
    });
    keyPress.contract = {
      arguments: {
        properties: [
          {
            name: "keys",
            displayName: "keys",
            path: "/keys",
            depth: 0,
            kind: "scalar",
            typeText: "string[]",
            required: true,
            comment: "最后一项是主键。",
            xmlHint: "",
            children: [],
            elements: [],
          },
        ],
      },
    } as unknown as RegisteredTool["contract"];
    const index = new AgentToolSearchIndex(createRegistry([keyPress]), createToolSearchConfig());

    expect(await actionableDiscoveryResults(index, { query: "我是谁" })).toEqual([]);
  });

  test("uses a declared identity phrase for a single-term request but not an incidental partial alias", async () => {
    const weather = createTool({
      name: "WeatherForecast",
      title: "Weather forecast",
      summary: "Get the current weather forecast.",
      tags: ["weather"],
      actions: ["forecast"],
      targets: ["city"],
      aliases: ["天气"],
      priority: 10,
    });
    const guide = createTool({
      name: "ToolGuide",
      title: "Tool guide",
      summary: "Explain available tools.",
      tags: ["guide"],
      actions: ["explain"],
      targets: ["tool"],
      aliases: ["使用说明"],
      priority: 20,
    });
    const index = new AgentToolSearchIndex(createRegistry([weather, guide]), createToolSearchConfig());

    expect((await actionableDiscoveryResults(index, { query: "天气" })).map((result) => result.toolName)).toEqual([
      "WeatherForecast",
    ]);
    expect(await actionableDiscoveryResults(index, { query: "说明" })).toEqual([]);
  });

  test("does not promote a generic lexical head without declaration-complete evidence", async () => {
    const guide = createTool({
      name: "AutomationGuide",
      title: "Automation guide",
      summary: "Recommend an automation approach.",
      tags: ["guide"],
      actions: ["recommend"],
      targets: ["automation"],
      aliases: ["使用说明"],
      priority: 10,
    });
    const capabilityIndex = {
      lexical: () => [{ name: guide.name, score: 1, queryTerms: ["说明"], matchedFields: {} }],
      fuzzy: () => [{ name: guide.name, score: 1 }],
      semantic: async () => [{ name: guide.name, score: 0.08 }],
    } as unknown as AgentCapabilitySearchIndex;
    const index = new AgentToolSearchIndex(createRegistry([guide]), createToolSearchConfig(), capabilityIndex);

    const discovery = await index.discoverHybrid({ query: "请用一句话说明你是谁" });

    expect(discovery.match).toEqual([]);
    expect(discovery.maybe).toEqual([expect.objectContaining({ toolName: guide.name })]);
  });

  test("downgrades colliding producer declarations instead of choosing by registration order", async () => {
    const first = createTool({
      name: "FirstImageGenerator",
      title: "First image generator",
      summary: "Generate an image from a prompt.",
      tags: ["image", "generate"],
      actions: ["generate"],
      targets: ["image"],
      aliases: ["生成图片"],
      priority: 10,
    });
    const second = createTool({
      name: "SecondImageGenerator",
      title: "Second image generator",
      summary: "Generate an image with an alternate backend.",
      tags: ["image", "generate"],
      actions: ["generate"],
      targets: ["image"],
      aliases: ["生成图片"],
      priority: 20,
    });
    const index = new AgentToolSearchIndex(createRegistry([first, second]), createToolSearchConfig());

    const discovery = await index.discoverHybrid({ query: "生成一张图片" });

    expect(discovery.match).toEqual([]);
    expect(discovery.maybe).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ toolName: first.name }),
        expect.objectContaining({ toolName: second.name }),
      ]),
    );
  });

  test("keeps a declared identity candidate when generic neighboring words are ambiguous", async () => {
    const git = createTool({
      name: "GitInspect",
      title: "Git inspection",
      summary: "Inspect a repository.",
      tags: ["repository"],
      actions: ["inspect"],
      targets: ["repository"],
      aliases: ["git"],
      priority: 20,
    });
    const checkpoint = createTool({
      name: "CheckpointInspector",
      title: "Checkpoint inspection",
      summary: "查看当前状态。",
      tags: ["state"],
      actions: ["inspect"],
      targets: ["checkpoint"],
      priority: 1,
    });
    const index = new AgentToolSearchIndex(createRegistry([git, checkpoint]), createToolSearchConfig());

    const discovery = await index.discoverHybrid({ query: "查一下当前 git 状态" });
    expect(discovery.match).toEqual([]);
    expect(discovery.maybe).toEqual(expect.arrayContaining([expect.objectContaining({ toolName: "GitInspect" })]));
  });

  test("keeps a complete lexical intent when a tool identity appears as a request value", async () => {
    const todo = createTool({
      name: "Todo",
      title: "Task list",
      summary: "Manage the current task list.",
      tags: ["task", "todo"],
      actions: ["read", "replace"],
      targets: ["session-task-list"],
      aliases: ["todo"],
      priority: 10,
    });
    const workspaceSearch = createTool({
      name: "WorkspaceSearch",
      title: "Workspace content search",
      summary: "Search contents in the workspace.",
      tags: ["workspace", "search"],
      actions: ["search"],
      targets: ["workspace", "file-content"],
      priority: 20,
    });
    const index = new AgentToolSearchIndex(createRegistry([todo, workspaceSearch]), createToolSearchConfig());

    const results = await actionableDiscoveryResults(index, { query: "search workspace todo" });

    expect(results.map((result) => result.toolName)).toEqual(["WorkspaceSearch"]);
  });

  test("prefers declared action and target facets over an incidental tool alias", async () => {
    const todo = createTool({
      name: "Todo",
      title: "Task list",
      summary: "Manage the current task list.",
      tags: ["task", "todo"],
      actions: ["read", "replace"],
      targets: ["session-task-list"],
      aliases: ["todo"],
      priority: 10,
    });
    const workspaceSearch = createTool({
      name: "WorkspaceSearch",
      title: "Workspace content search",
      summary: "Search contents in the workspace.",
      tags: ["workspace", "search"],
      actions: ["search"],
      targets: ["workspace", "file-content"],
      priority: 20,
    });
    const index = new AgentToolSearchIndex(createRegistry([todo, workspaceSearch]), createToolSearchConfig());

    const results = await actionableDiscoveryResults(index, { query: "search workspace todo" });

    expect(results[0]).toMatchObject({ toolName: "WorkspaceSearch" });
    expect(results[0]?.matchedCapabilities[0]?.matchedFacets).toEqual(expect.arrayContaining(["Actions", "Targets"]));
  });

  test("keeps a flat semantic neighbourhood as name-only possibilities", async () => {
    const image = createTool({
      name: "ImageGenerator",
      title: "Image generator",
      summary: "Create artwork from a prompt.",
      tags: ["artwork"],
      actions: ["create"],
      targets: ["image"],
      priority: 10,
    });
    const browser = createTool({
      name: "BrowserTyper",
      title: "Browser typer",
      summary: "Type text into a browser page.",
      tags: ["browser"],
      actions: ["type"],
      targets: ["browser-page"],
      priority: 20,
    });
    const config = createToolSearchConfig();
    let semanticCalls = 0;
    const capabilityIndex = {
      lexical: () => [],
      fuzzy: () => [],
      semantic: async () => {
        semanticCalls += 1;
        return [
          { name: "ImageGenerator", score: 0.58 },
          { name: "BrowserTyper", score: 0.51 },
        ];
      },
    } as unknown as AgentCapabilitySearchIndex;
    const index = new AgentToolSearchIndex(createRegistry([image, browser]), config, capabilityIndex);

    await expect(index.discoverHybrid({ query: "xylophone nebula" })).resolves.toMatchObject({
      match: [],
      maybe: [
        { toolName: "ImageGenerator", semanticScore: 0.58 },
        { toolName: "BrowserTyper", semanticScore: 0.51 },
      ],
      omitted: [],
    });
    expect(semanticCalls).toBe(1);
  });

  test("keeps a flat semantic frontier named instead of inflating source totals", async () => {
    const config = createToolSearchConfig();
    const tools = [
      createTool({
        name: "Alpha",
        title: "Alpha",
        summary: "Alpha",
        tags: ["alpha"],
        actions: ["read"],
        targets: ["alpha"],
        priority: 1,
        sourceId: "alpha",
      }),
      createTool({
        name: "Beta",
        title: "Beta",
        summary: "Beta",
        tags: ["beta"],
        actions: ["read"],
        targets: ["beta"],
        priority: 2,
        sourceId: "alpha",
      }),
      createTool({
        name: "Gamma",
        title: "Gamma",
        summary: "Gamma",
        tags: ["gamma"],
        actions: ["read"],
        targets: ["gamma"],
        priority: 3,
        sourceId: "beta",
      }),
      createTool({
        name: "Delta",
        title: "Delta",
        summary: "Delta",
        tags: ["delta"],
        actions: ["read"],
        targets: ["delta"],
        priority: 4,
        sourceId: "beta",
      }),
      createTool({
        name: "Epsilon",
        title: "Epsilon",
        summary: "Epsilon",
        tags: ["epsilon"],
        actions: ["read"],
        targets: ["epsilon"],
        priority: 5,
        sourceId: "beta",
      }),
    ];
    const capabilityIndex = {
      lexical: () => [],
      fuzzy: () => [],
      semantic: async () => tools.map((tool) => ({ name: tool.name, score: 0.4 })),
    } as unknown as AgentCapabilitySearchIndex;
    const index = new AgentToolSearchIndex(createRegistry(tools), config, capabilityIndex);

    const discovery = await index.discoverHybrid({ query: "xylophone nebula" });

    expect(discovery.match).toEqual([]);
    expect(discovery.maybe).toHaveLength(tools.length);
    expect(discovery.maybe).toEqual(
      expect.arrayContaining(tools.map((tool) => expect.objectContaining({ toolName: tool.name }))),
    );
    expect(discovery.omitted).toEqual([]);
  });

  test("does not require an absolute cosine score for an isolated semantic leader", async () => {
    const image = createTool({
      name: "ImageGenerator",
      title: "Image generator",
      summary: "Create artwork from a prompt.",
      tags: ["artwork"],
      actions: ["create"],
      targets: ["image"],
      priority: 10,
    });
    const browser = createTool({
      name: "BrowserTyper",
      title: "Browser typer",
      summary: "Type text into a browser page.",
      tags: ["browser"],
      actions: ["type"],
      targets: ["browser-page"],
      priority: 20,
    });
    const archive = createTool({
      name: "ArchiveReader",
      title: "Archive reader",
      summary: "Read an archived record.",
      tags: ["archive"],
      actions: ["read"],
      targets: ["archive"],
      priority: 30,
    });
    const config = createToolSearchConfig();
    const capabilityIndex = {
      lexical: () => [],
      fuzzy: () => [],
      semantic: async () => [
        { name: "ImageGenerator", score: 0.042 },
        { name: "BrowserTyper", score: 0.004 },
        { name: "ArchiveReader", score: 0.003 },
      ],
    } as unknown as AgentCapabilitySearchIndex;
    const index = new AgentToolSearchIndex(createRegistry([image, browser, archive]), config, capabilityIndex);

    await expect(index.discoverHybrid({ query: "long-form visual request" })).resolves.toMatchObject({
      match: [expect.objectContaining({ toolName: "ImageGenerator", semanticScore: 0.042 })],
    });
  });

  test("uses declared localized intent for a long Chinese MCP request", async () => {
    const imageGenerate = createTool({
      name: "mcp__imagen__ImageGenerate",
      title: "Generate Image",
      summary: "Generate one or more images from a prompt.",
      tags: ["image", "generation"],
      actions: ["generate"],
      targets: ["image"],
      aliases: ["生成图片", "图片生成", "文生图"],
      priority: 10,
    });
    const imageAnalyze = createTool({
      name: "ImageAnalyze",
      title: "Image analysis",
      summary: "Analyze image content and extract text.",
      tags: ["image", "vision"],
      actions: ["analyze"],
      targets: ["image"],
      aliases: ["分析图片", "识别图片"],
      priority: 20,
    });
    const index = new AgentToolSearchIndex(createRegistry([imageGenerate, imageAnalyze]), createToolSearchConfig());

    await expect(
      index.discoverHybrid({ query: "画一只类似这张照片的黑白奶牛猫，圆眼睛、无辜可爱的表情，生成一张图片" }),
    ).resolves.toMatchObject({
      match: [expect.objectContaining({ toolName: "mcp__imagen__ImageGenerate" })],
    });
  });

  test("keeps a semantic leader tentative when lexical evidence is also present", async () => {
    const image = createTool({
      name: "ImageGenerator",
      title: "Image generator",
      summary: "Create artwork from a prompt.",
      tags: ["artwork"],
      actions: ["create"],
      targets: ["image"],
      priority: 10,
    });
    const browser = createTool({
      name: "BrowserTyper",
      title: "Browser typer",
      summary: "Type text into a browser page.",
      tags: ["browser"],
      actions: ["type"],
      targets: ["browser-page"],
      priority: 20,
    });
    const archive = createTool({
      name: "ArchiveReader",
      title: "Archive reader",
      summary: "Read an archived record.",
      tags: ["archive"],
      actions: ["read"],
      targets: ["archive"],
      priority: 30,
    });
    const config = createToolSearchConfig();
    const capabilityIndex = {
      lexical: () => [],
      fuzzy: () => [],
      semantic: async () => [
        { name: "ImageGenerator", score: 0.62 },
        { name: "BrowserTyper", score: 0.4 },
        { name: "ArchiveReader", score: 0.39 },
      ],
    } as unknown as AgentCapabilitySearchIndex;
    const index = new AgentToolSearchIndex(createRegistry([image, browser, archive]), config, capabilityIndex);

    const discovery = await index.discoverHybrid({ query: "unmapped capability request" });

    expect(discovery.match).toEqual([]);
    expect(discovery.maybe).toEqual(
      expect.arrayContaining([expect.objectContaining({ toolName: "ImageGenerator", semanticScore: 0.62 })]),
    );
  });

  test("does not treat a URL host as a workspace path when routing a multi-step browser request", async () => {
    const workspaceRead = createTool({
      name: "WorkspaceRead",
      title: "Read workspace file",
      summary: "Read a workspace file.",
      tags: ["workspace", "read"],
      actions: ["read"],
      targets: ["file"],
      priority: 1,
    });
    workspaceRead.handler = {
      ...workspaceRead.handler,
      resources: [{ Capability: "senera.workspace.path", Pointer: "/path", Parameters: { Intent: "read" } }],
    };
    const browserOpen = createTool({
      name: "BrowserOpen",
      title: "Open browser URL",
      summary: "Open a public URL in the controlled browser.",
      tags: ["browser", "open"],
      actions: ["open"],
      targets: ["browser-page"],
      aliases: ["打开"],
      priority: 10,
    });
    browserOpen.handler = {
      ...browserOpen.handler,
      resources: [{ Capability: AgentToolResourceCapabilityIds.NetworkUrl, Pointer: "/url" }],
    };
    const screenshot = createTool({
      name: "BrowserScreenshot",
      title: "Capture browser screenshot",
      summary: "Capture the current browser page.",
      tags: ["browser", "screenshot"],
      actions: ["capture"],
      targets: ["browser-page"],
      aliases: ["截图"],
      priority: 20,
    });
    const index = new AgentToolSearchIndex(
      createRegistry([workspaceRead, browserOpen, screenshot]),
      createToolSearchConfig(),
      undefined,
      resourceDiscovery({
        [AgentToolResourceCapabilityIds.WorkspacePath]: [AgentToolResourceQueryShapes.Path],
        [AgentToolResourceCapabilityIds.NetworkUrl]: [AgentToolResourceQueryShapes.Url],
      }),
    );

    await expect(index.discoverHybrid({ query: "打开 https://example.com 并截图" })).resolves.toMatchObject({
      match: [expect.objectContaining({ toolName: "BrowserOpen" })],
      maybe: [expect.objectContaining({ toolName: "BrowserScreenshot" })],
    });
    expect(
      (await actionableDiscoveryResults(index, { query: "https://example.com" })).map((result) => result.toolName),
    ).toEqual(["BrowserOpen"]);
  });

  test("uses explicit identifiers and aliases for bounded fuzzy recovery", async () => {
    const browserScreenshot = createTool({
      name: "BrowserScreenshot",
      title: "Capture browser screenshot",
      summary: "Capture the current browser page as an image",
      tags: ["browser", "screenshot"],
      actions: ["capture", "screenshot"],
      targets: ["browser-page"],
      aliases: ["网页截图", "截图"],
      priority: 10,
    });
    const index = new AgentToolSearchIndex(createRegistry([browserScreenshot]), createToolSearchConfig());

    const recovered = await allDiscoveryResults(index, { query: "browserscreeshot" });
    const disabledConfig = createToolSearchConfig();
    disabledConfig.Fuzzy.Enabled = false;
    const disabled = await allDiscoveryResults(
      new AgentToolSearchIndex(createRegistry([browserScreenshot]), disabledConfig),
      { query: "browserscreeshot" },
    );

    expect(recovered.map((result) => result.toolName)).toEqual(["BrowserScreenshot"]);
    expect(recovered[0]?.ranks.fuzzy).toBe(1);
    expect(disabled).toEqual([]);
  });

  test("keeps all fused candidates available for curve-based disclosure", async () => {
    const config = createToolSearchConfig();
    const tools = Array.from({ length: 28 }, (_, id) =>
      createTool({
        name: `WorkspaceTool${id}`,
        title: `Workspace tool ${id}`,
        summary: "Read workspace files",
        tags: ["workspace", "file", "read"],
        actions: ["read"],
        targets: ["workspace", "file"],
        priority: 1,
      }),
    );
    const index = new AgentToolSearchIndex(createRegistry(tools), config);

    expect(await allDiscoveryResults(index, { query: "workspace file" })).toHaveLength(tools.length);
  });

  test("keeps relevant tools discoverable before execution approval", async () => {
    const tool = createTool({
      name: "WorkspaceEditFile",
      title: "Edit file",
      summary: "Apply targeted edits to workspace tool descriptions",
      tags: ["workspace", "edit"],
      actions: ["edit", "replace"],
      targets: ["workspace", "file"],
      examples: ["update a tool description"],
      sideEffect: "write-workspace",
      priority: 10,
    });
    const index = new AgentToolSearchIndex(createRegistry([tool]), createToolSearchConfig());

    expect((await allDiscoveryResults(index, { query: "tool description" })).map((result) => result.toolName)).toEqual([
      "WorkspaceEditFile",
    ]);
    expect(
      (await allDiscoveryResults(index, { query: "edit workspace file" })).map((result) => result.toolName),
    ).toEqual(["WorkspaceEditFile"]);
    expect(
      (await allDiscoveryResults(index, { query: "use WorkspaceEditFile" })).map((result) => result.toolName),
    ).toEqual(["WorkspaceEditFile"]);
  });
});

async function allDiscoveryResults(
  index: AgentToolSearchIndex,
  options: AgentToolSearchOptions,
): Promise<AgentToolSearchResult[]> {
  const discovery = await index.discoverHybrid(options);
  return [...discovery.match, ...discovery.maybe, ...discovery.omitted];
}

async function actionableDiscoveryResults(
  index: AgentToolSearchIndex,
  options: AgentToolSearchOptions,
): Promise<AgentToolSearchResult[]> {
  return [...(await index.discoverHybrid(options)).match];
}

function createRegistry(tools: RegisteredTool[]): AgentToolSearchRegistryReader {
  return {
    listTools: () => tools,
  };
}

function resourceDiscovery(
  declarations: Readonly<Record<string, readonly AgentToolResourceQueryShape[]>>,
): AgentToolResourceDiscoveryReader {
  return {
    getDiscovery: (capabilityId) => {
      const queryShapes = declarations[capabilityId];
      return queryShapes ? { queryShapes } : undefined;
    },
  };
}

function createTool(options: {
  name: string;
  title: string;
  summary: string;
  tags: string[];
  actions: string[];
  targets: string[];
  priority: number;
  examples?: string[];
  aliases?: string[];
  sideEffect?: string;
  sourceId?: string;
}): RegisteredTool {
  const sourceId = options.sourceId ?? "workspace";
  return {
    owner: {
      kind: "mcp",
      name: `${options.name}-owner`,
      title: options.title,
      description: options.summary,
      rootPath: process.cwd(),
      revision: "test",
      priority: options.priority,
      trusted: false,
      requiresApproval: false,
    },
    loading: "Dynamic",
    name: options.name,
    permissions: [],
    sources: [
      {
        Id: sourceId,
        Title: sourceId === "web" ? "Web" : "Workspace",
        Description:
          sourceId === "web"
            ? "Public internet information and current external data."
            : "Files and source code in the current workspace.",
      },
    ],
    handler: { kind: "HostCapability", capability: options.name },
    runtime: {
      Lifecycle: "Immediate",
      ProtocolVersion: 2,
      ResultAssessment: "ProcessExit",
      Capabilities: { Cancellation: true },
    },
    execution: {
      Targets: ["Local"],
      Network: "Deny",
      Workspace: "ReadOnly",
    },
    childGrant: "inherit",
    evidenceCapabilities: [],
    search: {
      Summary: options.summary,
      Tags: options.tags,
      UseCases: [options.summary],
      Examples: options.examples,
      Capabilities: [
        {
          Id: `${options.name}.capability`,
          Title: options.title,
          Description: options.summary,
          Facets: {
            Actions: options.actions,
            Targets: options.targets,
            Effects: options.sideEffect ? [options.sideEffect] : undefined,
          },
          Aliases: options.aliases,
          Risk: options.sideEffect ? { SideEffect: options.sideEffect } : undefined,
        },
      ],
    },
  };
}

function createToolSearchConfig(): ResolvedAgentToolSearchConfig {
  return {
    Fuzzy: {
      Enabled: true,
      MinScore: 0.25,
    },
    Embedding: {
      Enabled: true,
    },
    Memory: {
      MaxEpisodes: 100,
      HalfLifeDays: 30,
    },
    Tokenize: {
      Stopwords: [],
    },
    Ranking: {
      RrfK: 60,
      ChannelWeights: {
        bm25: 1,
        exact: 0.9,
        example: 1.1,
        fuzzy: 0.7,
        semantic: 0.5,
        structural: 1,
        memory: 0.6,
      },
    },
    Disclosure: {
      TokenBudget: 640,
    },
    Rerank: {
      Enabled: true,
      ScoreScale: 0.018,
      FeatureWeights: {},
    },
  };
}

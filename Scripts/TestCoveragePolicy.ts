export type CoverageThresholds = {
  lines: number;
  functions: number;
  branches: number;
  statements: number;
};

export type TestLayerPolicy = {
  name: string;
  minimumCases?: number;
  forbidsImportsFrom?: readonly string[];
};

export type TestSuiteCoveragePolicy = {
  label: string;
  testRoot: string;
  sourceRoot: string;
  testFilePattern: RegExp;
  sourceLocalTestPattern: RegExp;
  vitestConfig: string;
  verifyEntrypoint: string;
  runnerEntrypoint?: string;
  testInclude: readonly string[];
  setupFiles?: readonly string[];
  coverageDirectory: string;
  coverageInclude: readonly string[];
  coverageExclude: readonly string[];
  thresholds: CoverageThresholds;
  thresholdGroups?: readonly {
    pattern: string;
    thresholds: CoverageThresholds;
  }[];
  requiredLayers?: readonly TestLayerPolicy[];
};

export type TestSuitePolicy = Pick<
  TestSuiteCoveragePolicy,
  | "label"
  | "testRoot"
  | "sourceRoot"
  | "testFilePattern"
  | "sourceLocalTestPattern"
  | "vitestConfig"
  | "verifyEntrypoint"
  | "runnerEntrypoint"
  | "testInclude"
  | "requiredLayers"
>;

const sourceLocalTestPattern = /\.test\.(ts|tsx|js|jsx|mjs|mts)$/;

const frontendTestLayers = [
  { name: "Architecture", minimumCases: 6 },
  {
    name: "State",
    minimumCases: 8,
    forbidsImportsFrom: ["Frontend/src/features", "Frontend/src/app"],
  },
  { name: "Api", minimumCases: 10 },
  { name: "App", minimumCases: 15 },
  { name: "Store", minimumCases: 6 },
  { name: "Feature", minimumCases: 35 },
] as const satisfies readonly TestLayerPolicy[];

const backendTestLayers = [
  { name: "ActionPlanner", minimumCases: 10 },
  { name: "Artifacts", minimumCases: 8 },
  { name: "Auth", minimumCases: 12 },
  { name: "Config", minimumCases: 3 },
  { name: "Execution", minimumCases: 15 },
  { name: "Memory", minimumCases: 10 },
  { name: "ModelEndpoints", minimumCases: 12 },
  { name: "Pi", minimumCases: 10 },
  { name: "Runtime", minimumCases: 4 },
  { name: "Safety", minimumCases: 2 },
  { name: "Session", minimumCases: 10 },
  { name: "Text", minimumCases: 3 },
  { name: "ToolRuntime", minimumCases: 3 },
  { name: "ToolSearch", minimumCases: 3 },
  { name: "Uploads", minimumCases: 8 },
  { name: "WebSocket", minimumCases: 14 },
  { name: "Xml", minimumCases: 3 },
] as const satisfies readonly TestLayerPolicy[];

export const FrontendTestCoveragePolicy = {
  label: "Frontend",
  testRoot: "Scripts/FrontendTests",
  sourceRoot: "Frontend/src",
  testFilePattern: /\.test\.(mjs|ts)$/,
  sourceLocalTestPattern,
  vitestConfig: "vitest.config.ts",
  verifyEntrypoint: "Scripts/VerifyFrontendTestCoverage.ts",
  runnerEntrypoint: "Scripts/VerifyFrontendVitestSuite.ts",
  testInclude: ["Scripts/FrontendTests/**/*.test.mjs", "Scripts/FrontendTests/**/*.test.ts"],
  setupFiles: ["Scripts/FrontendTests/setup.ts"],
  coverageDirectory: "coverage/frontend",
  coverageInclude: ["Frontend/src/**/*.{ts,tsx}"],
  coverageExclude: ["Frontend/src/main.tsx", "Frontend/src/generated/**", "Frontend/src/**/*.d.ts"],
  thresholds: {
    lines: 53,
    functions: 52,
    branches: 40,
    statements: 50,
  },
  requiredLayers: frontendTestLayers,
} as const satisfies TestSuiteCoveragePolicy;

export const BackendTestCoveragePolicy = {
  label: "Backend",
  testRoot: "Scripts/BackendTests",
  sourceRoot: "Source/AgentSystem",
  testFilePattern: /\.test\.ts$/,
  sourceLocalTestPattern,
  vitestConfig: "vitest.backend.config.ts",
  verifyEntrypoint: "Scripts/VerifyBackendTestCoverage.ts",
  testInclude: ["Scripts/BackendTests/**/*.test.ts"],
  coverageDirectory: "coverage/backend",
  coverageInclude: ["Source/AgentSystem/**/*.ts"],
  coverageExclude: ["Source/AgentSystem/BamlClient/**", "Source/AgentSystem/**/*.d.ts"],
  thresholds: {
    lines: 40,
    functions: 38,
    branches: 28,
    statements: 40,
  },
  thresholdGroups: [
    {
      pattern:
        "Source/AgentSystem/{ActionPlanner,Auth,Execution,Memory,ModelEndpoints,Pi,Session,Text,ToolSearch,Uploads,Xml}/**/*.ts",
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 45,
        statements: 60,
      },
    },
  ],
  requiredLayers: backendTestLayers,
} as const satisfies TestSuiteCoveragePolicy;

export const E2eTestPolicy = {
  label: "E2E",
  testRoot: "Scripts/E2ETests",
  sourceRoot: "Source",
  testFilePattern: /\.test\.(mjs|ts)$/,
  sourceLocalTestPattern,
  vitestConfig: "vitest.e2e.config.ts",
  verifyEntrypoint: "Scripts/VerifyE2eTestCoverage.ts",
  runnerEntrypoint: "Scripts/VerifyE2eVitestSuite.ts",
  testInclude: ["Scripts/E2ETests/**/*.test.ts", "Scripts/E2ETests/**/*.test.mjs"],
  requiredLayers: [
    { name: "AgentProtocol", minimumCases: 3 },
    { name: "FrontendJourney", minimumCases: 2 },
    { name: "RuntimeIntegration", minimumCases: 1 },
  ],
} as const satisfies TestSuitePolicy;

export type ProjectTestCoveragePolicyName = "frontend" | "backend";

export const ProjectTestCoveragePolicies: Record<ProjectTestCoveragePolicyName, TestSuiteCoveragePolicy> = {
  frontend: FrontendTestCoveragePolicy,
  backend: BackendTestCoveragePolicy,
};

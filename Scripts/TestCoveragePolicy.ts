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
  requiredLayers?: readonly TestLayerPolicy[];
};

export type TestSuitePolicy = Pick<
  TestSuiteCoveragePolicy,
  "label" | "testRoot" | "sourceRoot" | "testFilePattern" | "sourceLocalTestPattern" | "vitestConfig" | "verifyEntrypoint" | "runnerEntrypoint" | "testInclude" | "requiredLayers"
>;

const sourceLocalTestPattern = /\.test\.(ts|tsx|js|jsx|mjs|mts)$/;

const frontendTestLayers = [
  {
    name: "State",
    forbidsImportsFrom: [
      "Frontend/src/features",
      "Frontend/src/app",
    ],
  },
  { name: "Api" },
  { name: "App" },
  { name: "Store" },
  { name: "Feature" },
] as const satisfies readonly TestLayerPolicy[];

const backendTestLayers = [
  { name: "ActionPlanner", minimumCases: 8 },
  { name: "Execution", minimumCases: 3 },
  { name: "Memory", minimumCases: 7 },
  { name: "Pi", minimumCases: 8 },
  { name: "Session", minimumCases: 3 },
  { name: "Text", minimumCases: 3 },
  { name: "ToolSearch", minimumCases: 3 },
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
  testInclude: [
    "Scripts/FrontendTests/**/*.test.mjs",
    "Scripts/FrontendTests/**/*.test.ts",
  ],
  setupFiles: [
    "Scripts/FrontendTests/setup.ts",
  ],
  coverageDirectory: "coverage/frontend",
  coverageInclude: [
    "Frontend/src/**/*.{ts,tsx}",
  ],
  coverageExclude: [
    "Frontend/src/main.tsx",
    "Frontend/src/generated/**",
    "Frontend/src/**/*.d.ts",
  ],
  thresholds: {
    lines: 22,
    functions: 18,
    branches: 13,
    statements: 21,
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
  testInclude: [
    "Scripts/BackendTests/**/*.test.ts",
  ],
  coverageDirectory: "coverage/backend",
  coverageInclude: backendTestLayers.map((layer) => `Source/AgentSystem/${layer.name}/**/*.ts`),
  coverageExclude: [
    "Source/AgentSystem/**/*.d.ts",
  ],
  thresholds: {
    lines: 25,
    functions: 25,
    branches: 20,
    statements: 25,
  },
  requiredLayers: backendTestLayers,
} as const satisfies TestSuiteCoveragePolicy;

export const E2eTestPolicy = {
  label: "E2E",
  testRoot: "Scripts/E2ETests",
  sourceRoot: "Source",
  testFilePattern: /\.test\.ts$/,
  sourceLocalTestPattern,
  vitestConfig: "vitest.e2e.config.ts",
  verifyEntrypoint: "Scripts/VerifyE2eTestCoverage.ts",
  runnerEntrypoint: "Scripts/VerifyE2eVitestSuite.ts",
  testInclude: [
    "Scripts/E2ETests/**/*.test.ts",
  ],
  requiredLayers: [
    { name: "AgentProtocol" },
  ],
} as const satisfies TestSuitePolicy;

export type ProjectTestCoveragePolicyName = "frontend" | "backend";

export const ProjectTestCoveragePolicies: Record<ProjectTestCoveragePolicyName, TestSuiteCoveragePolicy> = {
  frontend: FrontendTestCoveragePolicy,
  backend: BackendTestCoveragePolicy,
};

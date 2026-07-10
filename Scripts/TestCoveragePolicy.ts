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
    minimumCases: 8,
    forbidsImportsFrom: [
      "Frontend/src/features",
      "Frontend/src/app",
    ],
  },
  { name: "Api", minimumCases: 4 },
  { name: "App", minimumCases: 5 },
  { name: "Store", minimumCases: 6 },
  { name: "Feature", minimumCases: 20 },
] as const satisfies readonly TestLayerPolicy[];

const backendTestLayers = [
  { name: "ActionPlanner", minimumCases: 10 },
  { name: "Execution", minimumCases: 15 },
  { name: "Memory", minimumCases: 10 },
  { name: "Pi", minimumCases: 10 },
  { name: "Session", minimumCases: 10 },
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
    lines: 38,
    functions: 35,
    branches: 27,
    statements: 36,
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
    lines: 40,
    functions: 38,
    branches: 30,
    statements: 40,
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

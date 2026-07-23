import eslint from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

const TypeCheckedFiles = [
  "Apps/**/*.ts",
  "Build/**/*.ts",
  "Frontend/src/**/*.{ts,tsx}",
  "Scripts/**/*.ts",
  "Source/**/*.ts",
  "System/**/*.ts",
];

const TypeScriptFiles = ["**/*.{ts,tsx}"];

const NodeFiles = [
  "*.config.{js,mjs,cjs,ts}",
  "Apps/**/*.{js,mjs,cjs,ts}",
  "Build/**/*.{js,mjs,cjs,ts}",
  "Packages/**/*.{js,mjs,cjs,ts}",
  "Plugins/**/*.{js,mjs,cjs,ts}",
  "Scripts/**/*.{js,mjs,cjs,ts}",
  "Source/**/*.{js,mjs,cjs,ts}",
  "System/**/*.{js,mjs,cjs,ts}",
];

const FrontendFiles = ["Frontend/src/**/*.{ts,tsx}"];
const FrontendTestFiles = ["Scripts/FrontendTests/**/*.{js,mjs,ts,tsx}"];

const recommendedTypeScriptConfigs = tseslint.configs.recommended.map((config) => ({
  ...config,
  files: TypeScriptFiles,
}));

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      ".cache/**",
      ".senera*/**",
      ".trae-html-share-packages/**",
      ".uploads/**",
      "coverage/**",
      "Dist/**",
      "Frontend/.ladle/build/**",
      "Frontend/dist/**",
      "Release/**",
      "Source/AgentSystem/BamlClient/baml_client/**",
      "Plugins/**/Schemas/**/*.js",
      "senera-evaluation/**",
      "senera-project-analysis/**",
      "tmp/**",
    ],
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
  },
  eslint.configs.recommended,
  ...recommendedTypeScriptConfigs,
  {
    files: TypeCheckedFiles,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        {
          checksVoidReturn: {
            attributes: false,
          },
        },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: NodeFiles,
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: FrontendFiles,
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      "react-hooks/exhaustive-deps": "error",
      "react-hooks/rules-of-hooks": "error",
    },
  },
  {
    files: ["Frontend/public/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
  {
    files: [...FrontendTestFiles, "Scripts/E2ETests/FrontendJourney/**/*.{js,mjs,ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  eslintConfigPrettier,
);

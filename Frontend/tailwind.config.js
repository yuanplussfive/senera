/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Segoe UI Variable"', '"Segoe UI"', "ui-sans-serif", "system-ui", "sans-serif"],
        serif: ['"Fraunces"', "ui-serif", "Georgia", "serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "Menlo", "Consolas", "monospace"],
      },
      colors: {
        surface: {
          canvas: "var(--surface-canvas)",
          sidebar: "var(--surface-sidebar)",
          panel: "var(--surface-panel)",
          raised: "var(--surface-raised)",
          subtle: "var(--surface-subtle)",
          muted: "var(--surface-muted)",
          hover: "var(--surface-hover)",
        },
        content: {
          strong: "var(--content-strong)",
          primary: "var(--content-primary)",
          secondary: "var(--content-secondary)",
          muted: "var(--content-muted)",
          disabled: "var(--content-disabled)",
          inverse: "var(--content-inverse)",
        },
        line: {
          subtle: "var(--line-subtle)",
          DEFAULT: "var(--line-default)",
          strong: "var(--line-strong)",
        },
        accent: {
          50: "rgb(var(--color-accent-50) / <alpha-value>)",
          100: "rgb(var(--color-accent-100) / <alpha-value>)",
          200: "rgb(var(--color-accent-200) / <alpha-value>)",
          300: "rgb(var(--color-accent-300) / <alpha-value>)",
          400: "rgb(var(--color-accent-400) / <alpha-value>)",
          500: "rgb(var(--color-accent-500) / <alpha-value>)",
          600: "rgb(var(--color-accent-600) / <alpha-value>)",
          700: "rgb(var(--color-accent-700) / <alpha-value>)",
          solid: "var(--accent-solid)",
          "solid-hover": "var(--accent-solid-hover)",
          "solid-pressed": "var(--accent-solid-pressed)",
          content: "var(--accent-content)",
          "content-hover": "var(--accent-content-hover)",
          surface: "var(--accent-surface)",
          "surface-hover": "var(--accent-surface-hover)",
          border: "var(--accent-border)",
          "border-strong": "var(--accent-border-strong)",
          focus: "var(--accent-focus-ring)",
          "on-solid": "var(--accent-on-solid)",
        },
        // Neutral application surfaces.
        paper: {
          50: "rgb(var(--color-paper-50) / <alpha-value>)",
          100: "rgb(var(--color-paper-100) / <alpha-value>)",
          200: "rgb(var(--color-paper-200) / <alpha-value>)",
          300: "rgb(var(--color-paper-300) / <alpha-value>)",
          400: "rgb(var(--color-paper-400) / <alpha-value>)",
        },
        // Neutral foreground scale.
        ink: {
          950: "rgb(var(--color-ink-950) / <alpha-value>)",
          900: "rgb(var(--color-ink-900) / <alpha-value>)",
          850: "rgb(var(--color-ink-850) / <alpha-value>)",
          800: "rgb(var(--color-ink-800) / <alpha-value>)",
          700: "rgb(var(--color-ink-700) / <alpha-value>)",
          650: "rgb(var(--color-ink-650) / <alpha-value>)",
          600: "rgb(var(--color-ink-600) / <alpha-value>)",
          500: "rgb(var(--color-ink-500) / <alpha-value>)",
          400: "rgb(var(--color-ink-400) / <alpha-value>)",
          350: "rgb(var(--color-ink-350) / <alpha-value>)",
          300: "rgb(var(--color-ink-300) / <alpha-value>)",
          200: "rgb(var(--color-ink-200) / <alpha-value>)",
          100: "rgb(var(--color-ink-100) / <alpha-value>)",
          50: "rgb(var(--color-ink-50) / <alpha-value>)",
        },
        // 焦土橘——唯一强调色
        terra: {
          50: "rgb(var(--color-terra-50) / <alpha-value>)",
          100: "rgb(var(--color-terra-100) / <alpha-value>)",
          200: "rgb(var(--color-terra-200) / <alpha-value>)",
          300: "rgb(var(--color-terra-300) / <alpha-value>)",
          400: "rgb(var(--color-terra-400) / <alpha-value>)",
          500: "rgb(var(--color-terra-500) / <alpha-value>)",
          600: "rgb(var(--color-terra-600) / <alpha-value>)",
          700: "rgb(var(--color-terra-700) / <alpha-value>)",
        },
        // 苔绿——完成态
        moss: {
          50: "rgb(var(--color-moss-50) / <alpha-value>)",
          100: "rgb(var(--color-moss-100) / <alpha-value>)",
          400: "rgb(var(--color-moss-400) / <alpha-value>)",
          500: "rgb(var(--color-moss-500) / <alpha-value>)",
          600: "rgb(var(--color-moss-600) / <alpha-value>)",
        },
        // 暖棕——进行中状态，避免误读成错误
        umber: {
          50: "rgb(var(--color-umber-50) / <alpha-value>)",
          100: "rgb(var(--color-umber-100) / <alpha-value>)",
          200: "rgb(var(--color-umber-200) / <alpha-value>)",
          500: "rgb(var(--color-umber-500) / <alpha-value>)",
          600: "rgb(var(--color-umber-600) / <alpha-value>)",
        },
        // 砖红——错误（柔和警告色，参考 Claude Code）
        brick: {
          50: "rgb(var(--color-brick-50) / <alpha-value>)",
          100: "rgb(var(--color-brick-100) / <alpha-value>)",
          200: "rgb(var(--color-brick-200) / <alpha-value>)",
          500: "rgb(var(--color-brick-500) / <alpha-value>)",
          600: "rgb(var(--color-brick-600) / <alpha-value>)",
          700: "rgb(var(--color-brick-700) / <alpha-value>)",
        },
      },
      boxShadow: {
        accent: "var(--accent-shadow)",
        "bubble-user": "var(--shadow-bubble-user)",
        "bubble-ai": "var(--shadow-bubble-ai)",
        panel: "var(--shadow-panel)",
        soft: "var(--shadow-soft)",
      },
      animation: {
        caret: "caret 1.1s ease-in-out infinite",
        shimmer: "shimmer 2s linear infinite",
        "fade-in": "fadeIn 0.18s ease-out both",
        // Dialog content must not animate transform, otherwise it overrides Tailwind translate centering.
        "dialog-in": "dialogIn 0.16s ease-out both",
        "dialog-out": "dialogOut 0.12s ease-in both",
      },
      keyframes: {
        caret: {
          "0%, 50%": { opacity: "1" },
          "50.01%, 100%": { opacity: "0" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        fadeIn: {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        dialogIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        dialogOut: {
          "0%": { opacity: "1" },
          "100%": { opacity: "0" },
        },
      },
    },
  },
  plugins: [],
};

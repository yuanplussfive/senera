/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Geist"', "ui-sans-serif", "system-ui", "sans-serif"],
        serif: ['"Fraunces"', "ui-serif", "Georgia", "serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "Menlo", "Consolas", "monospace"],
      },
      colors: {
        // 暖纸面色板
        paper: {
          50: "#fdfcf8",
          100: "#faf8f3",
          200: "#f3f0e8",
          300: "#e9e4d6",
          400: "#d6cfbc",
        },
        // 深墨色文字
        ink: {
          900: "#1c1a17",
          800: "#2b2823",
          700: "#3f3b34",
          600: "#5a554c",
          500: "#787266",
          400: "#9c9685",
          300: "#bdb7a4",
          200: "#dad4c2",
        },
        // 焦土橘——唯一强调色
        terra: {
          50: "#fbf2ed",
          100: "#f4dfd2",
          200: "#e7b89e",
          300: "#d68a65",
          400: "#c46337",
          500: "#b3441f",
          600: "#933618",
          700: "#722811",
        },
        // 苔绿——完成态
        moss: {
          50: "#f0f3eb",
          100: "#dbe2cb",
          400: "#7d9866",
          500: "#5a7d4c",
          600: "#456239",
        },
        // 暖棕——进行中状态，避免误读成错误
        umber: {
          50: "#f7f0e4",
          100: "#eadcc5",
          200: "#d2ba8d",
          500: "#8a6a3f",
          600: "#705632",
        },
        // 砖红——错误（柔和警告色，参考 Claude Code）
        brick: {
          50: "#fef6ee",   // 极浅琥珀橙
          100: "#fde8d7",  // 浅琥珀橙
          200: "#fac9a4",  // 柔和橙
          500: "#d97706",  // 琥珀橙（主色）
          600: "#b45309",  // 深琥珀橙
        },
      },
      boxShadow: {
        "bubble-user": "0 1px 0 rgba(28, 26, 23, 0.04)",
        "bubble-ai": "0 1px 0 rgba(28, 26, 23, 0.06), 0 0 0 1px rgba(28, 26, 23, 0.05)",
        "panel": "0 0 0 1px rgba(28, 26, 23, 0.06)",
        "soft": "0 8px 24px -12px rgba(28, 26, 23, 0.18)",
      },
      animation: {
        "caret": "caret 1.1s ease-in-out infinite",
        "shimmer": "shimmer 2s linear infinite",
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

/** @type {import('@ladle/react').UserConfig} */
export default {
  stories: "src/**/*.stories.{tsx,ts}",
  addons: {
    theme: {
      enabled: true,
      defaultState: "senera-light",
    },
    width: {
      enabled: true,
      options: {
        手机: 390,
        紧凑桌面: 900,
        标准桌面: 1280,
        宽屏桌面: 1440,
        超宽桌面: 1600,
      },
      defaultState: 0,
    },
  },
  viteConfig: "./vite.config.ts",
  base: "/ladle/",
  outDir: ".ladle/build",
};

/** @type {import('@ladle/react').UserConfig} */
export default {
  stories: "src/**/*.stories.{tsx,ts}",
  addons: {
    theme: {
      enabled: true,
      defaultState: "senera-light",
    },
  },
  viteConfig: "./vite.config.ts",
  base: "/ladle/",
  outDir: ".ladle/build",
};

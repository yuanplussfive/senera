export const DesktopLocales = {
  ZhCn: "zh-CN",
  EnUs: "en-US",
} as const;

export type DesktopLocale = (typeof DesktopLocales)[keyof typeof DesktopLocales];
export type DesktopMessageKey = keyof typeof DesktopMessagesZhCn;
export type DesktopMessageParams = Readonly<Record<string, string | number | boolean | null | undefined>>;

const DesktopMessagesZhCn = {
  "startup.failedTitle": "Senera 启动失败",
  "tray.show": "显示 Senera",
  "tray.quit": "退出 Senera",
  "settings.title": "Senera 设置",
} as const;

const DesktopMessagesEnUs: Record<DesktopMessageKey, string> = {
  "startup.failedTitle": "Senera failed to start",
  "tray.show": "Show Senera",
  "tray.quit": "Quit Senera",
  "settings.title": "Senera settings",
};

const DesktopMessageCatalog: Record<DesktopLocale, Record<DesktopMessageKey, string>> = {
  [DesktopLocales.ZhCn]: DesktopMessagesZhCn,
  [DesktopLocales.EnUs]: DesktopMessagesEnUs,
};

export function resolveDesktopLocale(value: string | null | undefined): DesktopLocale {
  return value?.toLocaleLowerCase().startsWith("zh") ? DesktopLocales.ZhCn : DesktopLocales.EnUs;
}

export function desktopMessage(
  key: DesktopMessageKey,
  params: DesktopMessageParams = {},
  locale: string | null | undefined = DesktopLocales.ZhCn,
): string {
  return DesktopMessageCatalog[resolveDesktopLocale(locale)][key].replace(
    /\{([A-Za-z0-9_]+)\}/g,
    (match, name: string) => {
      const value = params[name];
      return value === undefined || value === null ? match : String(value);
    },
  );
}

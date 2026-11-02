# 插件与渠道品牌图标

品牌仅用于标识对应平台，不表示官方合作。所有资源本地打包，不发起图标网络请求。

- Git、Telegram、Discord：来自已有依赖 `@iconify-icons/logos`，保留该包的许可与来源。
- Tencent QQ：来自 [Simple Icons v13.21.0](https://github.com/simple-icons/simple-icons/blob/13.21.0/icons/tencentqq.svg)，[CC0-1.0](https://github.com/simple-icons/simple-icons/blob/13.21.0/LICENSE.md)。仅按原始路径缩放显示，商标权归原权利人。
- Senera QQ 与 QQ 官方渠道都使用 QQ 图标，以渠道名称区分；本地图标的唯一注册处是 `shared/ui/BrandIcon.tsx`，插件目录和会话导航共同复用。

语义图标仍通过 `AppIcon` / `AgentToolPresentationIcon`。扩展通过清单声明品牌，不根据包名猜图标。

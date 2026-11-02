# QFace 表情资源

本目录同步自 [koishijs/QFace](https://github.com/koishijs/QFace)，
上游版本为 `8fac1fa62c16e91e3221b439ad3f9f2f5c4b1f1d`。

Senera 通过 `public/assets/qq_emoji/_index.json` 读取表情索引，
并由 `Frontend/qq/build/vite.ts` 将引用的图片和动画复制到 QQ 客户端。
客户端使用宿主的 npm workspace 和根目录 `package-lock.json` 构建。

此处保留资源、来源说明和许可证。上游演示站点、资源生成脚本、
独立依赖清单和锁文件不参与宿主构建，已移除。
更新表情时，从上游同步资源及索引，并在此记录对应版本。

表情资源来自腾讯，版权归原权利人所有。
QFace 代码由 Koishi 团队维护，使用 MIT 许可证，详见 `LICENSE`。

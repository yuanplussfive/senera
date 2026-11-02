# 按需安装的 Senera QQ 客户端

主程序和基础 APK 只携带主控台。Senera QQ 单独构建为客户端 ZIP，在「设置 → 渠道 → Senera QQ」安装发行版或导入 ZIP，再点击打开。电脑使用现有 Electron 窗口，手机使用现有 WebView，不需要另装 QQ APK。

安装属于应用宿主，存放在应用数据目录下的 `.senera/client-extensions/senera-qq/`，所有工作区共用一次安装，切换工作区无需重新安装。应用数据目录由现有应用路径服务解析，可通过 `SENERA_DATA_ROOT` 或部署的 `applicationStateRoot` 指定，不写入程序安装目录。手机从已连接的电脑加载扩展，使用 WebView 的标准持久缓存；这不是能脱离电脑运行的离线客户端。渠道配置、会话和附件仍分别保存到各工作区，使用 QQ 时需在目标工作区启用渠道。

QQ 独立构建包含自身的完整 JS、样式、字体和表情，主程序升级不会替换已打开页面引用的旧版本文件。认证控制器、上传队列、草稿、发件箱、资源预览、实时连接继续直接引用主控台源码，不复制业务实现。手机仍使用既有原生文件选择、下载和消息通道。无需新增 Android 权限。

## 打包命令

在仓库根目录执行，输出位于 `Release/`。

```bash
# 基础手机 APK，通用架构，开发签名
npm run mobile.android

# 仅 ARM64，适合大多数近年的实体手机
npm run mobile.android -- --abi=arm64-v8a

# 已有 Frontend/dist 时直接同步和打包，供 CI 复用
npm run mobile.android.from-build
npm run mobile.android.from-build -- --abi=arm64-v8a

# 正式签名的 APK
npm run mobile.android.release
npm run mobile.android.from-build -- --release

# 独立 QQ 客户端及对应源码
npm run client.qq.pack

# 已完成独立 QQ 构建时只打包
npm run build.qq-client
npm run client.qq.pack.from-build

# 桌面安装包，默认不内置 QQ 扩展
npm run desktop.pack
```

Android 构建需要 JDK 21、Android SDK（版本由 Android 工程声明）和已接受的 SDK 许可。通过标准 `JAVA_HOME`、`ANDROID_HOME` 或 Android 的 `local.properties` 指定工具链；Gradle wrapper 使用工程固定版本。已有工具链位于 `.cache/mobile-toolchain/` 时，可将这些环境变量指向其中实际的 Java、SDK 目录，并以 `GRADLE_USER_HOME` 指定原有 Gradle 缓存。

`--abi` 接受 `arm64-v8a`、`armeabi-v7a`、`x86`、`x86_64`，逗号分隔；省略则打包全部支持架构。输出名包含版本、架构和构建类型。

正式 APK 必须显式配置以下环境变量，缺失时构建报错：

- `SENERA_ANDROID_KEYSTORE`：签名文件的绝对路径。
- `SENERA_ANDROID_STORE_PASSWORD`：签名库密码。
- `SENERA_ANDROID_KEY_ALIAS`：签名别名。
- `SENERA_ANDROID_KEY_PASSWORD`：签名密码。

## PR 和发版

PR 新建、追加提交、重新打开或编辑后，Verify 自动构建基础 APK 和 QQ 扩展。Actions 的 `senera-android-apk`、`senera-qq-client` artifacts 保留 7 天。APK 使用开发签名，QQ ZIP 可以直接导入设置。Android 复用已有前端构建，不重复执行 Vite；QQ 仅构建一次。

正式发布自动上传 QQ ZIP、描述文件和对应源码包。发行版安装地址从产品更新源与当前产品版本推导，支持自定义仓库和下载 URL 模板。网络、校验或协议版本不兼容时返回错误，原来的安装保持有效。尚未发布的 PR 版本使用导入 ZIP。

正式发版同步构建并上传同版本的 Android APK、桌面安装包和 QQ 扩展。Android 复用本次前端构建，APK 文件名由打包脚本和发布元数据共用的契约生成；发布前检查必需产物的名称与非空内容。

在仓库 Actions secrets 中配置 `SENERA_ANDROID_KEYSTORE_BASE64`（签名库的 Base64）、`SENERA_ANDROID_STORE_PASSWORD` 和 `SENERA_ANDROID_KEY_PASSWORD`；公开的签名别名 `SENERA_ANDROID_KEY_ALIAS` 配置为 Actions variable。不要把别名同时存成 secret：GitHub 会将包含别名的公开发布元数据误判为密钥并丢弃任务输出，例如镜像身份标识。发布流程在各产品开始构建前集中检查配置，缺失时列出变量名并停止；签名、构建或 APK 上传失败同样阻止发布。CI 临时解码签名库并在步骤结束删除，PR 不读取这些 secrets。后续版本沿用同一签名身份，才能覆盖升级已有正式安装。

## 包与安装

QQ 输出为 `SeneraQQ-<版本>.zip`、`SeneraQQ-<版本>.json` 和带内容版本号的 `*-source.tar.gz`。ZIP 首项为 `client-extension.json`，声明宿主协议版本、入口和每个资源的大小与 SHA-256。源码另包交付，保留许可证和对应源码下载入口。

安装器拒绝路径穿越、链接、大小超限、缺失或未声明的文件、摘要不匹配和不兼容的宿主协议。宿主持有唯一扩展存储，统一所有工作区的安装锁和版本缓存。文件在临时目录校验完成后才切换活动版本。更新对所有工作区生效，旧版本继续服务已打开页面；卸载移除所有工作区共用的扩展全部版本，不修改渠道设置、聊天数据库和附件。

页面与资源通过原有工作区路由提供，继续使用主控台的会话认证；安装与卸载经过相同的 CSRF 校验。资源 URL 包含内容版本，不使用主控台当前构建中的同名文件代替扩展依赖。日常入口在开发宿主上同样只加载已安装版本，不接入 Vite 热更新。开发源码页面使用工作区客户端路由下显式的 `development/` 入口；该入口只在开发宿主启用。

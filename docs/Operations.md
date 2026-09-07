# Senera 部署与运维

这份文档写给实际部署、更新和排查 Senera 的人。日常本地开发看 README 就够了；跑 Docker、更新镜像、处理数据目录权限和沙箱状态时，看这里。

## Artifact 维护

服务运行期间会按 `Artifacts.MaintenanceIntervalMinutes` 自动执行 artifact 保留、总量配额和半成品回收。目录扫描使用 `Artifacts.MaintenanceMaxConcurrency` 控制文件系统并发，默认值为 4，避免大量 artifact 同时打开过多文件句柄。需要手动检查时，默认命令只分析，不删除文件：

```powershell
npm run maintenance.artifacts
npm run maintenance.artifacts.json
```

确认报告后使用 `npm run maintenance.artifacts.apply` 执行清理。工作区、配置文件或 artifact 根目录不在默认位置时，可传 `--workspace`、`--config` 或 `--root`。

## Docker 启动

容器监听 `8787`，运行数据默认放在容器内的 `/data`。可通过 `SENERA_WORKSPACE_ROOT` 配置一个绝对 POSIX 路径；应用、named volume 和沙箱 guest mount 会从同一个值派生，不需要分别修改三处路径。`compose.yaml` 使用 Docker named volume，首次部署不需要先处理宿主机目录权限。Docker 部署不需要把 `/dev/kvm` 或 `NET_ADMIN` 传给 Senera 主服务；宿主已注册 `runsc` 时使用 gVisor，否则使用受限 Docker Engine 容器。

受控浏览器随应用镜像安装 Chromium，因此 Docker 部署不需要再执行 `playwright install` 或在宿主机安装 Chrome。容器没有图形显示服务器，浏览器扩展应保持 `runtime.headed: false`；需要观察页面操作时，请在桌面端启用“显示浏览器窗口”。

镜像入口默认在权限准备阶段以 root 运行后通过 `exec` 降权为 `node`；`compose.yaml` 显式设置 `SENERA_CONTAINER_RUNTIME_USER: root`，主进程保持 root 运行，使容器内嵌入的沙箱 Worker 能访问 Docker Engine。嵌入 Worker 只接受版本化 Worker 协议允许的镜像、挂载和资源策略，主服务通过进程内私有 Unix Socket 访问它。

Senera 不提供可直接用于生产的默认密码。首次启动前，直接编辑 `compose.yaml` 中已写明的管理员资料。浏览器同源访问会根据请求 Host 自动放行；只有跨域前端才需要在 `Server.AccessControl.AllowedOrigins` 中额外声明：

```yaml
SENERA_ADMIN_LOGIN_NAME: "admin"
SENERA_ADMIN_DISPLAY_NAME: "Your Name"
SENERA_ADMIN_PASSWORD: "replace-with-a-strong-password"
```

然后启动：

```bash
# 生产环境固定应用镜像的发布 digest；未设置时 Compose 使用已验证的 latest 标签。
export SENERA_IMAGE=ghcr.io/yuanplussfive/senera@sha256:<application-digest>
docker compose pull
docker compose up -d --pull always
docker compose logs -f senera
```

默认应用镜像是 `ghcr.io/yuanplussfive/senera:latest`；沙箱运行时默认解析为内置分发契约对应的版本化 `sandbox-runtime-*` 镜像，可在 `environment` 中通过 `SENERA_DOCKER_SANDBOX_IMAGE` 覆盖。它们只在产品发布通过桌面安装包、容器构建、沙箱和 Compose smoke 后更新；需要可复现部署或回退时，始终改用对应发布的 digest。

应用镜像不是可独立运行的单容器部署单元。不要用 `docker run` 绕过编排；主服务需要 Compose 提供的数据卷和 Docker Engine socket，并在容器内拉起嵌入 Worker。Worker 会在 `auto` 模式下检测 Docker Engine：已注册 `runsc` 时使用 gVisor，否则使用受限 Docker Engine provider；Worker 不可用属于部署不完整，容器会在打开 Web 服务前明确失败。

#### 单服务安全边界

`compose.yaml` 是单服务模式：Senera 与嵌入的沙箱 Worker 合并为单个容器，管理字段只有端口、管理员资料、数据卷和 Docker Engine socket。使用前必须理解其安全边界：

- 主进程保持 root 运行（`SENERA_CONTAINER_RUNTIME_USER: root` 显式门控），容器直挂 `/var/run/docker.sock`，因此任何能以该进程身份执行的漏洞都直接控制 Docker Engine。

- 受控浏览器在 root 下运行，容器内的 Chromium 会自动附加 `--no-sandbox`（仅当 `SENERA_CONTAINER=1` 且进程 uid 为 0），放弃浏览器进程自身的沙箱。

- 嵌入 Worker 使用固定卷名 `senera-data` 和 Docker Engine 端点；沙箱容器本身仍保持只读根文件系统、能力全移除与 `no-new-privileges`。

- 适合内网单机、开发验证或管理型部署；生产、多租户或不可信网络请前置 HTTPS 反向代理并加固宿主。若宿主运行了不受信任的容器，Docker Socket 挂载会扩大其影响范围。

如需覆盖沙箱运行时镜像，在 `environment` 中设置 `SENERA_DOCKER_SANDBOX_IMAGE` 与 `SENERA_DOCKER_SANDBOX_PULL_POLICY`；未设置时使用内置分发契约镜像。

Docker Web 的认证、上传和其他 HTTP API 默认校验浏览器 Origin 与当前请求 Host 的同源关系。容器入口显式启用的回环 HTTP 例外还允许本机 `localhost`、`127.0.0.1` 或 `::1` 在不同端口提供前端（例如开发 Vite 或本机端口映射）；公网域名/IP 仍必须使用 `Server.AccessControl.AllowedOrigins` 显式声明并配合 HTTPS。因此通过 `https://senera.example.com` 反向代理时，浏览器请求保持在同一域名并经过代理；容器内部的 `127.0.0.1` 不会暴露给访问者。动态 `senera-runtime-config.js` 使用 `no-store`，代理也不应覆盖该响应的缓存策略。

容器每次启动都会读取这三个管理员环境变量并与 `${SENERA_WORKSPACE_ROOT:-/data}/.senera/access/admin-account.json` 对账。内容相同则不重写；登录名、显示名或密码变化时原子更新账户，因此编辑 YAML 后重启即可生效。密码只以 `scrypt` 哈希写入账户文件，但原始密码仍会出现在部署 YAML 和 Docker 容器环境中，因此不得提交包含真实密码的 `compose.yaml`。启动成功后打开 `http://localhost:8787` 或实际访问地址。

容器健康检查使用 `GET /health/ready`，不会把登录状态误判成服务故障。排障时可以分别检查：

```bash
curl http://127.0.0.1:8787/health/live
curl http://127.0.0.1:8787/health/ready
```

两者都不要求管理员会话，也不会返回账户或配置内容。`live` 失败表示 HTTP 进程不可达；`ready` 失败表示服务尚未完成启动。`GET /api/auth/session` 则专门返回 `disabled`、`anonymous` 或 `authenticated` 会话状态，匿名状态是正常的 `200` 响应。

### 原生 SQLite 依赖

Docker 镜像运行的是标准 Node.js 24，不是 Electron，因此不需要安装系统 `sqlite3` 命令，也不需要执行 Electron ABI 重建。应用使用的 SQLite 驱动是 npm 依赖 `better-sqlite3`；镜像构建会在跳过依赖安装脚本后，使用镜像内的编译工具为 Node ABI 构建该原生模块，并在裁剪生产依赖后运行 SQLite smoke test。桌面端则由 Electron 打包流程单独准备自己的原生模块。

### 受控浏览器

受控浏览器的控制层是生产依赖 `playwright-core`，它不下载也不携带浏览器二进制。这样桌面安装包不会额外内置第二个 Chromium，运行时也不会在用户机器上隐式下载浏览器。

- Windows 桌面端自动发现当前用户已安装的 Chrome、Edge 或 Brave。`runtime.headed: true` 会打开独立的受控浏览器窗口，不使用 Electron 的渲染窗口；留空 `runtime.executablePath` 即可，只有自动发现失败或要固定版本时才填写路径。

- 官方 Docker 镜像已安装 Chromium 与运行所需字体，容器部署不需要挂载宿主浏览器。镜像没有显示服务器，因此必须保持 `runtime.headed: false`；启用可见窗口会在启动前返回明确配置错误。容器默认以 root 运行 Chromium 并自动附加 `--no-sandbox`（`SENERA_CONTAINER=1` 且进程 uid 为 0 时），并启用 `--disable-dev-shm-usage` 以适配 Docker 默认共享内存大小。

- 裸 Linux 源码或二进制部署需要自行安装 Chrome、Chromium 或兼容的发行版包及其系统依赖，然后保持默认自动发现，或通过 `runtime.executablePath` 指向实际可执行文件。不要执行 `playwright install` 作为 Senera 运行时前提；那是仓库 E2E 测试使用的受管测试浏览器。

受控会话拥有单独的临时 profile，不读取或改写用户日常浏览器的 profile、Cookie 与启动参数。浏览器找不到时会指出应安装浏览器或配置可执行路径，而不是退回 Electron WebView 或静默关闭浏览能力。

桌面端的安装资源和工作区是两个有意分离的路径：安装资源位于 Electron 的 `resources` 目录，随版本更新、只读使用；首次启动由用户选择或新建工作区，所有可写项目数据统一落在该工作区的 `.senera/` 下。Windows 的应用数据目录只保存工作区定位指针，避免把配置、会话、日志或升级状态默认写入 C 盘；从旧版本升级时，旧 `runtime` 中仍存在的配置数据库、升级记录和沙箱缓存会迁移到新工作区。

默认 `compose.yaml` 做了这些事情：

- `senera-data:${SENERA_WORKSPACE_ROOT:-/data}`：配置、数据库、会话、artifact 和工作区 Skills（卷名固定为 `senera-data`，与嵌入 Worker 使用同一个派生工作区根）。

- `8787:8787`：宿主机所有网络接口发布 `8787`，访问控制由同源校验、仅限回环来源的自动跨端口例外、可选公网 Origin 配置和管理员认证负责。

- `/var/run/docker.sock:/var/run/docker.sock`：容器直挂 Docker Engine socket，供嵌入 Worker 创建受限沙箱容器。

- 嵌入 Worker：主进程以 root 运行并在容器内启动 Worker；Worker 独占 Docker API 调用，只接受版本化 Worker 协议允许的镜像、挂载和资源策略。

Docker 不会把 Sandbox 请求改为本机执行。`runsc` 未注册时，启动协商会锁定受限 Docker Engine provider；Docker Engine 不可连接、声明的 runtime 镜像不可用或 Worker 不可用时，容器会在打开 Web 服务前明确失败，不会在工具执行阶段静默切换。Local 工具与 Sandbox 边界保持独立。

`compose.yaml` 以 root 运行主进程；未设置 `SENERA_CONTAINER_RUNTIME_USER` 时入口会在权限准备后降权为 `node`。手工执行容器内诊断命令时应沿用进程实际身份，例如 `docker compose exec -T senera id`；不要依赖 `docker exec` 的默认用户。

工作区 Skill 位于数据卷的 `${SENERA_WORKSPACE_ROOT:-/data}/.senera/skills`。它由运行时用户直接维护，不会在容器启动时被内置资源覆盖；官方只读 Skills 和 MCP packages 随镜像位于 `/app/System/Skills` 与 `/app/McpServers`。

运行时数据库不接受配置路径，统一由工作区布局解析并按领域存放：配置修订与本地密钥位于 `.senera/data/config/`，会话位于 `.senera/data/sessions/`，长期记忆位于 `.senera/data/memory/`，Tool/Skill 路由学习位于 `.senera/data/tool-search/`。升级时旧数据库文件族会整体迁移，WAL、SHM 和 recovery 文件不会被拆散；当新旧库同时存在时，旧库保存在对应领域的 `legacy/` 目录，不覆盖当前库。

如果服务器上 `8787` 已被占用，在启动前指定另一个主机端口：

```yaml
ports:
  - "18787:8787"
```

无需再把端口地址逐个加入环境变量；浏览器同源 Origin 会自动匹配当前 Host，本机回环前端也可使用不同端口。公网或其他非回环跨域前端仍需在工作区配置中的 `Server.AccessControl.AllowedOrigins` 声明完整 Origin。所有部署值都直接在 `compose.yaml` 或工作区配置中修改。

## 管理员访问

浏览器和手机 Web 端登录后会获得 HttpOnly Cookie。会话最长 72 小时，连续 12 小时没有实际请求会失效；服务重启也会使所有会话重新登录。退出登录或重置密码会立即撤销会话。

忘记密码或需要更换管理员资料时，直接修改 `compose.yaml` 中对应的 `SENERA_ADMIN_*` 值并重启。启动同步会更新账户，服务重启也会撤销原有会话：

```bash
docker compose restart senera
```

本机源码运行时使用同一套命令：

```bash
npm run access.admin -- init --workspace .
```

桌面端不显示管理员登录页，它只绑定本机 loopback 运行时。

## 本机与公网

`compose.yaml` 将端口发布为 `8787:8787`，本机可直接访问：

```bash
http://localhost:8787
```

默认 YAML 自动接受浏览器当前地址的同源 Origin，也允许本机回环地址使用不同端口，不需要逐个填写本机 IP。跨域前端仍需在 `Server.AccessControl.AllowedOrigins` 中填写完整公网 Origin，例如 `https://senera.example.com`。

Docker 镜像不终止 TLS。回环地址的本地 HTTP 会自动工作，非回环地址默认要求 HTTPS；公网正式部署应使用 HTTPS/WSS 反向代理，并只在 `Server.AccessControl.TrustedProxyAddresses` 中填写实际代理地址：

```yaml
Server:
  AccessControl:
    TrustedProxyAddresses: ["172.20.0.10"]
```

远程服务的明文 HTTP 登录默认拒绝；只有配置文件中的 `Server.AccessControl.AllowInsecureHttp: true` 才会显式放行可信网络。若 TLS 在反向代理终止，`TrustedProxyAddresses` 只能填写实际代理的内部地址，不能信任任意 `X-Forwarded-Proto` 请求头。不要把明文登录端口直接暴露给公网。

`Server.AccessControl` 提供会话、连接、握手和消息配额；密码、Cookie、管理员账户文件和 CSRF 值不属于该配置，也不应提交到仓库。WebSocket、上传和模型兼容 API 使用同一认证边界，外部协议见 [WebSocket 协议参考](API/WebSocketProtocol.md)。

## 首次配置

第一次启动时，如果工作区根（默认 `/data`）下的 `senera.config.json` 不存在，容器会从内置的 `senera.config.example.json` 生成一份。设置 `SENERA_WORKSPACE_ROOT` 后，以下示例中的 `/data` 替换为实际工作区根即可。

默认 named volume 不会把配置文件直接放在当前目录。如果要编辑配置，先导出到当前目录：

```bash
docker compose exec -T senera cat /data/senera.config.json > senera.config.json
```

编辑 `senera.config.json` 后，再写回容器。这里通过 `exec` 以容器实际身份写文件，不会破坏 `/data` 的权限：

```bash
docker compose exec -T senera sh -lc "cat > /data/senera.config.json" < senera.config.json
docker compose restart senera
```

重点填这几项：

- `ModelProviderEndpoints[].BaseUrl`

- `ModelProviderEndpoints[].ApiKey`

- `ModelProviders[].Model`

`ApiKey` 可以在首次配置时暂时以明文填写；运行时读取后会立即以 AES-256-GCM 密文写回 JSON 镜像和 SQLite 的全部配置 revision，配置迁移备份也使用密文。推荐通过设置页修改供应商凭据，避免直接操作已经由 SQLite 接管的 JSON 镜像。

密钥优先从 `SENERA_CONFIG_SECRET_KEY` 读取，值必须是 32 字节随机数据的 base64url 编码。可以用 Node.js 生成：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

密钥只能生成一次并持久保存，不要在每次启动时重新生成。Compose 已把宿主机变量映射进主服务；本地部署可以将 `SENERA_CONFIG_SECRET_KEY=<生成值>` 写入仓库已忽略的 `.env`，正式部署应使用平台提供的独立 secret。

未设置该变量时，运行时会生成 `.senera/data/config/config-secrets.key`（Docker 数据目录下为 `/data/.senera/data/config/config-secrets.key`）。这个本地 key 能防止配置 JSON 或数据库被单独复制后直接读出 API key，但不能抵御同时取得数据目录和 key 文件的主机级攻击。备份时必须保留密钥，丢失或直接更换密钥会导致已有凭据无法解密。

## 上传容量与回收

上传文件保存在 `Uploads.RootDir`，默认是数据目录中的 `.senera/uploads`。服务端按流处理 multipart 请求，不会先把整个请求读进内存，并同时执行以下限制：

- `MaxFileBytes`：单个文件上限，默认 50 MiB。

- `MaxRequestBytes`：一个 multipart 请求的总字节上限，默认 100 MiB，必须不小于 `MaxFileBytes`。

- `MaxFilesPerRequest`：单次请求最多文件数，默认 8。

- `MaxConcurrentUploads`：同一上传根目录允许的并发写入数，默认 4；超过时返回 HTTP 429。

- `MaxStoredBytes`：上传根目录总容量，默认 2 GiB，必须不小于 `MaxFileBytes`；容量不足时返回 HTTP 507。

- `RetentionHours`：上传成功后的保留时间，默认 720 小时（30 天）。过期文件会被删除，旧会话中的对应附件也将无法再次读取。

- `MaintenanceIntervalMinutes`：容量核对和过期回收间隔，默认 15 分钟。服务启动时也会立即执行一次维护。

并发写入会按每个文件的最大尺寸预留容量，防止多个请求同时越过总配额。因此 `MaxStoredBytes` 应为当前保留文件留出空间，并至少能容纳一个 `MaxFileBytes`。请求失败时，本次已经写完的文件会回滚；服务异常退出留下的无 manifest 目录会在一小时宽限期后清理。

需要立即释放空间时，可以先停止服务，再备份并清理 `Uploads.RootDir`。不要在服务运行期间手工删除正在写入的子目录。

## 非 root 容器

`compose.yaml` 以 root 运行主进程（`SENERA_CONTAINER_RUNTIME_USER: root`），以便嵌入 Worker 访问 Docker Engine；未设置该变量时，镜像入口会在权限准备后降权为镜像里的 `node` 用户。默认 named volume 会自动处理权限，直接启动即可。

如果你想把数据放在当前项目目录，方便直接备份和编辑，可以把 `compose.yaml` 里的 volume 改成 bind mount：

```yaml
volumes:
  - ./docker-data:${SENERA_WORKSPACE_ROOT:-/data}
  - /var/run/docker.sock:/var/run/docker.sock
```

Linux 主机上使用 bind mount 时，宿主机目录要允许容器内的沙箱用户写入（沙箱容器仍以非 root `node` 用户运行）：

```bash
mkdir -p docker-data
sudo chown -R 1000:1000 docker-data
```

只要最终 `/data` 可写，Senera 就能正常启动。

## 更新版本

桌面端可以在“设置 → 关于”中手动检查更新。新版本会先下载到 Electron 更新缓存，下载完成后再由用户点击重启安装；发布包带有 `latest.yml` 和 blockmap，因此相邻版本通常只下载差异内容。更新失败不会覆盖当前安装，重新检查即可重试。

网页端和 Docker 端只提供版本检查与发布入口，不能安全地从正在运行的服务进程替换自身。Docker 更新由部署主机执行，先把镜像变量改成目标版本发布的完整 digest，再启动：

```bash
export SENERA_IMAGE=ghcr.io/yuanplussfive/senera@sha256:<application-digest>
export SENERA_DOCKER_SANDBOX_IMAGE=ghcr.io/yuanplussfive/senera@sha256:<sandbox-digest>
docker compose up -d --pull always
docker compose images
```

未配置 `SENERA_UPDATE_MANIFEST_URL` 时，运行时会从产品仓库的最新 Release 读取 `senera-update.json`。自建镜像或发布源应将该变量指向同样结构的清单；清单只用于检查和展示，Docker 镜像仍以 Compose 中的镜像引用为准。

Senera 对需要迁移的权威配置和 SQLite 数据执行固定流程：`备份 -> 校验 -> dry-run -> 迁移 -> 启动 -> GET /health/ready`。升级日志和运行时标记使用 `schemaVersion: 3`，保存在 `.senera/upgrades/`；只有 readiness 探测成功才提交健康状态。可用下面的命令查看运行中镜像声明的版本和镜像 ID：

```bash
docker inspect "$(docker compose ps -q senera)" --format '{{index .Config.Labels "org.opencontainers.image.version"}} {{.Image}}'
```

数据会继续留在 Compose 项目自己的 `senera-data` volume。实际 volume 名称可以用 `docker volume ls` 查看；同一主机运行多个部署时，为每个编排设置不同的 Compose 项目名。内置备份不替代部署级灾备，大版本升级前仍建议导出完整 volume：

```bash
docker compose exec -T senera tar czf - -C /data . > senera-data-backup.tgz
```

如果你改成了 `./docker-data:/data`，直接备份 `docker-data/` 目录即可。

启动或健康检查失败时，Senera 会自动恢复本次升级涉及的配置和权威数据库。迁移日志与备份不会因失败被删除，失败时的新数据会移到对应操作目录的 `failed-state/`，而不是直接删除。查看状态：

```bash
senera upgrade status --workspace /data
```

需要手动回滚一次已经健康完成的迁移时，先停止所有 Senera 进程，再执行：

```bash
senera rollback --yes --workspace /data --data-root /data
```

可用 `--upgrade <id>` 指定 `upgrade status` 列出的操作。回滚会恢复该操作的备份并保留被替换的数据；它不会替换正在运行的程序或容器镜像。Docker 部署还需要把 `SENERA_IMAGE` 和 `SENERA_DOCKER_SANDBOX_IMAGE` 改回清单 `source` 中记录的旧 digest，再重新启动。容器内执行 CLI 时可使用：

```bash
docker compose stop
docker compose run --rm --no-deps --user node --entrypoint node senera Dist/Apps/SeneraCli.js rollback --yes --workspace /data --data-root /data
docker compose up -d
```

## 发布与回滚

GitHub 的验证、版本决策和产物构建彼此分离。普通提交不会直接修改版本或构建正式安装包。

- Pull Request：运行类型检查、行为测试、前端测试和 Windows 平台验证。

- 合并到 `main`：Verify 成功后，Release Please 根据 Conventional Commits 创建或更新发布 PR。

- 发布 PR：带有 `autorelease: pending` 标签且来自 Release Please 的 PR 会启用 GitHub auto-merge；只有 `main` 的保护规则和状态检查全部通过后才会自动合并。

- 合并发布 PR：自动更新根 `package.json`、`package-lock.json` 和 `CHANGELOG.md`，随后创建 `vX.Y.Z` 标签与草稿 GitHub Release。

- 产品发布：`Product Release` 从该标签检出源码，验证标签与根包版本一致，然后并行构建桌面安装包和容器镜像；全部成功后才公开 Release 并标记为 latest。

提交类型决定 SemVer 变化：

- `fix:` 发布 patch；

- `feat:` 发布 minor；

- `feat!:` 或正文中的 `BREAKING CHANGE:` 发布 major；

- `docs:`、`test:`、`chore:` 默认不单独推进产品版本。

提交标题必须使用 Conventional Commit 的英文类型和半角冒号，说明文字可以使用中文。例如 `fix: 修复 Windows 沙箱启动失败`、`feat: 增加管理员登录`、`refactor: 拆分配置变更控制器`。不要使用裸中文标题或全角冒号（如 `修复：...`）；Verify 会校验本次提交范围，避免 Release Please 静默跳过版本发布。

GitHub Advanced Security 的 Copilot Autofix 会生成固定格式的安全修复提交，该完整消息由 commitlint
单独识别。GitHub squash merge 可能把官方 bot 的超长 `Co-authored-by` 行加入标准提交；只有该固定行免于
footer 长度限制，其他 Conventional Commit 和 footer 规则仍然生效。

Release Please 创建的 PR 需要正常通过 Verify。仓库必须在 `Settings -> General -> Pull Requests` 启用 `Allow auto-merge`。建议配置 `RELEASE_PLEASE_TOKEN`，使用可触发 Pull Request 工作流的 GitHub App token 或细粒度 PAT；未配置时工作流会回退到 `GITHUB_TOKEN`，bot PR 可能需要维护者手动批准工作流。

正式发布失败时，手动运行 `Product Release`，填写已经存在的 `vX.Y.Z`。工作流会重新验证并覆盖上传同一标签的产物，不会创建新版本。

容器回退应直接固定上一个已验证 digest，而不是重新标记源码：

```bash
export SENERA_IMAGE=ghcr.io/<owner>/senera@sha256:<previous-application-digest>
export SENERA_DOCKER_SANDBOX_IMAGE=ghcr.io/<owner>/senera@sha256:<previous-sandbox-digest>
```

修改部署版本后重新拉取并启动：

```bash
docker compose up -d --pull always
```

## 日志和健康状态

看日志：

```bash
docker compose logs -f senera
```

看容器健康状态：

```bash
docker compose ps
docker inspect --format "{{json .State.Health}}" senera
```

排查复杂问题时，可以临时打开更详细的事件日志：

```yaml
environment:
  SENERA_LOG_EVENTS: verbose
```

改完 `compose.yaml` 后重新启动：

```bash
docker compose up -d
```

## 沙箱状态

Docker 的沙箱运行时使用现有公开 `senera` GHCR package 中独立的 `sandbox-runtime-*` 标签发布，拥有自己的 OCI manifest 与 digest，不需要维护第二个 package 的可见性。默认镜像由应用启动时从内置分发契约解析（`resolveAgentSandboxDistributionTarget(...).registryImage`），生产环境可在 `environment` 中通过 `SENERA_DOCKER_SANDBOX_IMAGE` 固定 digest；Worker 核对分发 ID、版本、架构和固定源镜像 digest labels，再使用启动时锁定的 provider 执行隔离探测。Worker 没有归档导入、隐式拉取或 fallback 路径；主服务不直接调用 Docker CLI。

发布流水线使用 BuildKit 为应用镜像和沙箱镜像生成并附加 SPDX SBOM。可按 digest 检查远端 attestation：

```bash
docker buildx imagetools inspect "$SENERA_IMAGE" --format '{{ json .SBOM }}'
docker buildx imagetools inspect "$SENERA_DOCKER_SANDBOX_IMAGE" --format '{{ json .SBOM }}'
```

Compose 镜像部署使用 Docker Worker 协议与 OCI 运行时合同。`auto` 模式先验证连接的是 Linux Docker Engine，再读取已注册 runtime：存在 `runsc` 时锁定 gVisor，否则锁定收紧权限的 daemon-default 容器。显式选择 gVisor 而 Engine 未注册 `runsc` 会直接报配置错误；一次服务生命周期不会切换 provider，也不会退回本机执行。

需要验证 Compose 沙箱运行时时，可运行 `npm run sandbox.prepare`。该命令从固定 digest 的 Node 基础镜像构建本地 runtime，写入分发身份 labels，同时添加 registry 标签，然后以只读根文件系统、非 root 用户、无网络和全能力移除策略逐项探测 `bash`、`git`、`node`、`npm`、`python`、`pip`、`rg`、`jq`、`curl`、`ssh` 与 Linux Terminal Sidecar。正常启动按 `SandboxRuntime.Docker.PullPolicy` 使用 `always`、`if-missing` 或 `never`；镜像 labels、Engine API、Linux OS 或工具探针不符合合同都会在准备阶段失败。PTY Sidecar 及其 Linux 原生依赖直接属于版本化 runtime 镜像。

桌面端、Nano 和源码开发使用受治理的宿主机 Node/进程边界，不启动 Docker Worker，也不要求用户安装 Docker。只有 Compose 镜像部署在容器内启动嵌入 Worker 访问 Docker Engine；Windows 使用 named pipe，Unix 使用私有 Unix Socket。应用主进程不直接调用 Docker API。

工作区通过 Docker bind 或 named volume 直接挂载，不复制源码树，因此 `.git`、`.senera` 和普通项目文件都保持可见，启动成本不随仓库体积线性增长。执行合同决定整个工作区挂载是只读还是可写；额外可写挂载和 rootfs copy 都必须落在 Worker 启动时建立的来源白名单内。

Worker 协议不接受镜像字段，模型或工具调用无法选择任意镜像。镜像、runtime、网络模式、只读根、capability、资源上限和挂载策略全部由部署及版本化合同控制。单次容器失败只影响该调用；Engine 协商或镜像准备失败则通过正式沙箱状态事件暴露，不存在字符串猜测式重试或全局隐式降级。

桌面和 Nano 不携带离线沙箱归档。发布流水线只为 Compose 构建一次候选 runtime 镜像，使用 Compose + 可选 gVisor 做真实 smoke，再把已验证 digest 提升为稳定标签。应用镜像和 runtime 镜像均附带 SBOM；生产部署应固定 digest。

修改 Worker、挂载或 runtime 合同后执行 `npm run verify.sandbox.real`。该命令构建并探测本地 runtime，再验证真实 Shell 和 PTY 链路；它需要已启动的 Linux Docker Engine。

PTY 后台终端也通过同一执行边界路由。资源快照会返回 `requestedBoundary`、`effectiveBoundary`、
`backend`、`capabilities`、`sandboxId` 和审批信息。Docker Engine Worker 支持交互输入和信号；
只有实际后端声明 `resize` 时前端才启用终端尺寸调整。

本地命令、后台进程和 PTY 的环境继承可以统一收敛：

```json
{
  "Defaults": {
    "ToolExecution": {
      "MaxConcurrentCallsPerRun": 10,
      "SemanticAudit": {
        "Mode": "approval_sensitive"
      },
      "Environment": {
        "Inherit": "none",
        "IncludeOnly": ["PATH", "HOME"],
        "Exclude": [],
        "Set": {}
      }
    }
  }
}
```

`MaxConcurrentCallsPerRun` limits ordinary tool executions within one agent run. Calls above the limit queue instead of failing. System Tool contracts may impose a lower tool-wide `Runtime.MaxConcurrency`, declare resource conflicts, or opt into `SelfManaged` scheduling; the effective concurrency therefore never exceeds the strictest applicable policy.

`SemanticAudit.Mode` controls the optional BAML parameter review, not the deterministic safety boundary. `approval_sensitive` only reviews a deterministically allowed BAML-planned call under `always_ask`, where the result can still request user approval. Native Tool Calling, `agent`, `full_access`, and `disabled` never create that advisory BAML request. `full_access` skips user approval for `ask` decisions but still preserves deterministic rejection. Access grants, OPA, schema validation, execution targets, workspace policy, and sandbox enforcement remain active in every mode.

`Set` 最后应用并覆盖同名值。所有 Sandbox provider 都不继承宿主环境，只接收执行画像和调用显式投影的变量。

唯一的 `compose.yaml` 不再传递 `/dev/kvm` 或 `NET_ADMIN`。单服务模式以 root 运行主进程并直挂 Docker Engine Socket（`SENERA_CONTAINER_RUNTIME_USER: root` 显式门控），嵌入 Worker 是唯一执行 Docker API 调用的组件；沙箱容器本身仍保持非 root 用户、能力全移除与只读根文件系统。管理员可在宿主预先安装并注册 `runsc` 以获得更强的 gVisor 隔离；未注册时使用受限 Docker Engine 容器。容器不会擅自修改宿主守护进程配置。

## 依赖安装策略

仓库会提交根目录的 `package-lock.json`。CI、Docker、桌面端发布都使用可复现安装：

```bash
npm ci
```

只有主动增删依赖时才使用：

```bash
npm install <package>
```

这种情况下需要一起提交：

- `package.json`

- `package-lock.json`

如果你只是本地不小心改了 lockfile，可以恢复后重新安装：

```bash
git restore package-lock.json
npm ci
```

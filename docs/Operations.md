# Senera 部署与运维

这份文档写给实际部署、更新和排查 Senera 的人。日常本地开发看 README 就够了；跑 Docker、更新镜像、处理数据目录权限和沙箱状态时，看这里。

## Artifact 维护

服务运行期间会按 `Artifacts.MaintenanceIntervalMinutes` 自动执行 artifact 保留、总量配额和半成品回收。目录扫描使用 `Artifacts.MaintenanceMaxConcurrency` 控制文件系统并发，默认值为 4，避免大量 artifact 同时打开过多文件句柄。需要手动检查时，默认命令只分析，不删除文件：

```powershell
npm run maintenance.artifacts
npm run maintenance.artifacts.json
```

确认报告后使用 `npm run maintenance.artifacts.apply` 执行清理。工作区、配置文件或 artifact 根目录不在默认位置时，可传 `--workspace`、`--config` 或 `--root`。

## Pi Planner 延迟基准

默认诊断只调用动作选择模型；所有模式都不会创建会话、执行工具或写入会话数据库：

```powershell
npm run benchmark.pi-planner
npm run benchmark.pi-planner -- -- --planning-model-provider-id=gemini-3.5-flash --iterations=3
npm run benchmark.pi-planner -- -- --stage=prepare-interaction --iterations=3
npm run benchmark.pi-planner -- -- --stage=direct-flow --iterations=3
```

输出包含每次请求的首 token、总耗时、请求/响应字符数和动作类型。`--stage` 支持 `prepare-interaction`、`select-action`、`direct-flow` 或 `both`。`direct-flow` 会真实生成最终文本，但仍不创建会话、不执行工具，可用于衡量用户看到首段文本前的完整直答延迟。

## Docker 启动

容器监听 `8787`，所有运行数据都放在容器内的 `/data`。`compose.yaml` 使用 Docker named volume，首次部署不需要先处理宿主机目录权限。Docker 部署不需要把 `/dev/kvm` 或 `NET_ADMIN` 传给 Senera 主服务；宿主已注册 `runsc` 时使用 gVisor，否则使用受限 Docker Engine 容器。

镜像入口只在权限准备阶段以 root 运行，然后通过 `exec` 以非 root `node` 启动主服务。Compose 另起一个网络隔离、只读的 `sandbox-worker`，该 Worker 是唯一挂载 Docker Engine Socket 的组件，并且只接受版本化 Worker 协议允许的镜像、挂载和资源策略；主服务仅通过私有 Unix Socket 访问 Worker。

Senera 不提供可直接用于生产的默认密码。首次启动前，直接编辑 `compose.yaml` 中已写明的管理员资料和访问 Origin：

```yaml
SENERA_ADMIN_LOGIN_NAME: "admin"
SENERA_ADMIN_DISPLAY_NAME: "Your Name"
SENERA_ADMIN_PASSWORD: "replace-with-a-strong-password"
SENERA_ALLOWED_ORIGINS: "http://localhost:8787,http://127.0.0.1:8787,http://192.168.1.20:8787"
SENERA_ALLOW_INSECURE_HTTP: "true"
```

然后启动：

```bash
# 生产环境固定应用和沙箱镜像的发布 digest；未设置时 Compose 使用版本 tag。
export SENERA_IMAGE=ghcr.io/yuanplussfive/senera@sha256:<application-digest>
export SENERA_SANDBOX_IMAGE=ghcr.io/yuanplussfive/senera@sha256:<sandbox-digest>
docker compose pull
docker compose up -d --pull always
docker compose logs -f senera
```

应用镜像不是可独立运行的单容器部署单元。不要用 `docker run` 绕过编排；主服务需要 Compose 创建的 `sandbox-worker`、私有控制 Socket 和共享数据卷。Worker 会在 `auto` 模式下检测 Docker Engine：已注册 `runsc` 时使用 gVisor，否则使用受限 Docker Engine provider；缺少 Worker 本身属于部署不完整，不会降级为让主服务直接访问 Docker Socket。

Docker Web 的认证、上传和其他 HTTP API 固定使用浏览器当前 Origin，WebSocket 地址不会改写 HTTP API 地址。因此通过 `https://senera.example.com` 反向代理时，浏览器请求保持在同一域名并经过代理；容器内部的 `127.0.0.1` 不会暴露给访问者。动态 `senera-runtime-config.js` 使用 `no-store`，代理也不应覆盖该响应的缓存策略。

容器每次启动都会读取这三个管理员环境变量并与 `/data/.senera/access/admin-account.json` 对账。内容相同则不重写；登录名、显示名或密码变化时原子更新账户，因此编辑 YAML 后重启即可生效。密码只以 `scrypt` 哈希写入账户文件，但原始密码仍会出现在部署 YAML 和 Docker 容器环境中，因此不得提交包含真实密码的 `compose.yaml`。启动成功后打开 `http://localhost:8787` 或已加入 Origin 白名单的 IP 地址。

容器健康检查使用 `GET /health/ready`，不会把登录状态误判成服务故障。排障时可以分别检查：

```bash
curl http://127.0.0.1:8787/health/live
curl http://127.0.0.1:8787/health/ready
```

两者都不要求管理员会话，也不会返回账户或配置内容。`live` 失败表示 HTTP 进程不可达；`ready` 失败表示服务尚未完成启动。`GET /api/auth/session` 则专门返回 `disabled`、`anonymous` 或 `authenticated` 会话状态，匿名状态是正常的 `200` 响应。

### 原生 SQLite 依赖

Docker 镜像运行的是标准 Node.js 22，不是 Electron，因此不需要安装系统 `sqlite3` 命令，也不需要执行 Electron ABI 重建。应用使用的 SQLite 驱动是 npm 依赖 `better-sqlite3`；镜像构建会在跳过依赖安装脚本后，使用镜像内的编译工具为 Node ABI 构建该原生模块，并在裁剪生产依赖后运行 SQLite smoke test。桌面端则由 Electron 打包流程单独准备自己的原生模块。

默认 `compose.yaml` 做了这些事情：

- `senera-data:/data`：配置、数据库、会话和用户插件。
- `8787:8787`：宿主机所有网络接口发布 `8787`，访问控制仍由精确 Origin 白名单和管理员认证负责。
- `sandbox-runtime`：由 Compose 按标准 Registry 流程拉取并执行一次版本探测，成功后镜像留在 Docker Engine 本地存储。
- `sandbox-worker`：网络隔离、只读的受限 Worker；它独占 Docker Engine Socket，主服务只持有控制 Socket。

Docker 不会把 Sandbox 请求改为本机执行。`runsc` 未注册时，启动协商会锁定受限 Docker Engine provider；Docker Engine 不可连接、声明的 runtime 镜像未由 Compose 准备或 Worker 不可用时，容器会在打开 Web 服务前明确失败，不会在工具执行阶段静默切换。Local 工具与 Sandbox 边界保持独立。

应用进程和镜像健康检查都以 `node` 运行。镜像必须先以 root 进入权限准备入口，因此手工执行容器内诊断命令时应显式沿用应用身份，例如 `docker compose exec -T --user node senera id`；不要依赖 `docker exec` 的默认用户。

镜像内置的用户插件会在容器启动时同步到 `/data/Plugins`。该目录属于数据卷，插件的
`PluginConfig.toml` 会保留用户修改；放入该目录的自定义插件也不会被启动同步清理。

如果服务器上 `8787` 已被占用，在启动前指定另一个主机端口：

```yaml
ports:
  - "18787:8787"
```

同时把浏览器实际使用的 `http://IP:18787` 加入 `SENERA_ALLOWED_ORIGINS`。所有部署值都直接在 `compose.yaml` 中修改，不依赖额外的 `.env` 或面板环境变量。

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

默认 YAML 允许 `localhost` 和 `127.0.0.1`。使用 IP 时必须把浏览器地址栏中的完整 Origin 加入同一字段，例如 `http://192.168.1.20:8787`；端口不同时也必须精确填写。

`SENERA_ALLOW_INSECURE_HTTP: "true"` 明确允许白名单 Origin 通过明文 HTTP 登录，适合可信局域网或用户明确接受风险的 IP 部署。公网正式部署应使用 HTTPS/WSS 反向代理，并把该值改为 `"false"`；域名、IPv4 与 IPv6 地址都填写浏览器实际访问的完整 Origin：

```yaml
SENERA_ALLOWED_ORIGINS: "https://senera.example.com,https://203.0.113.10"
SENERA_ALLOW_INSECURE_HTTP: "false"
```

远程服务默认拒绝明文 HTTP 登录；只有同时启用 `SENERA_ALLOW_INSECURE_HTTP` 并精确列入 Origin 时才允许。若 TLS 在反向代理终止，配置中的 `Server.AccessControl.TrustedProxyAddresses` 只能填写实际代理的内部地址，不能信任任意 `X-Forwarded-Proto` 请求头。不要把启用明文登录的端口直接暴露给公网。

`Server.AccessControl` 提供会话、连接、握手和消息配额；密码、Cookie、管理员账户文件和 CSRF 值不属于该配置，也不应提交到仓库。WebSocket 和上传/Pi Proxy API 使用同一认证边界，外部协议见 [WebSocket 协议参考](API/WebSocketProtocol.md)。

## 首次配置

第一次启动时，如果 `/data/senera.config.json` 不存在，容器会从内置的 `senera.config.example.json` 生成一份。

默认 named volume 不会把配置文件直接放在当前目录。如果要编辑配置，先导出到当前目录：

```bash
docker compose exec -T senera cat /data/senera.config.json > senera.config.json
```

编辑 `senera.config.json` 后，再写回容器。这里用容器内的 `node` 用户写文件，不会破坏 `/data` 的权限：

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

未设置该变量时，运行时会生成 `.senera/config-secrets.key`（Docker 数据目录下为 `/data/.senera/config-secrets.key`）。这个本地 key 能防止配置 JSON 或数据库被单独复制后直接读出 API key，但不能抵御同时取得数据目录和 key 文件的主机级攻击。备份时必须保留密钥，丢失或直接更换密钥会导致已有凭据无法解密。

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

Senera 容器运行时使用镜像里的 `node` 用户，不用 root 跑服务。默认 named volume 会自动处理权限，直接启动即可。

如果你想把数据放在当前项目目录，方便直接备份和编辑，可以把 `compose.yaml` 里的 volume 改成 bind mount：

```yaml
volumes:
  - ./docker-data:/data
```

Linux 主机上使用 bind mount 时，宿主机目录要允许容器用户写入：

```bash
mkdir -p docker-data
sudo chown -R 1000:1000 docker-data
```

只要最终 `/data` 可写，Senera 就能正常启动。

## 更新版本

普通更新先将两个变量改成目标版本发布的完整 digest，再启动：

```bash
export SENERA_IMAGE=ghcr.io/yuanplussfive/senera@sha256:<application-digest>
export SENERA_SANDBOX_IMAGE=ghcr.io/yuanplussfive/senera@sha256:<sandbox-digest>
docker compose up -d --pull always
docker compose images
```

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

可用 `--upgrade <id>` 指定 `upgrade status` 列出的操作。回滚会恢复该操作的备份并保留被替换的数据；它不会替换正在运行的程序或容器镜像。Docker 部署还需要把 `SENERA_IMAGE` 和 `SENERA_SANDBOX_IMAGE` 改回清单 `source` 中记录的旧 digest，再重新启动。容器内执行 CLI 时可使用：

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
export SENERA_SANDBOX_IMAGE=ghcr.io/<owner>/senera@sha256:<previous-sandbox-digest>
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

Docker 的沙箱运行时使用现有公开 `senera` GHCR package 中独立的 `sandbox-runtime-*` 标签发布，拥有自己的 OCI manifest 与 digest，不需要维护第二个 package 的可见性。Compose 使用一个 YAML anchor 同时为 `sandbox-runtime` 服务和 Worker 声明同一引用；生产环境通过 `SENERA_SANDBOX_IMAGE` 固定 digest，前者负责标准拉取与版本探测，后者核对分发 ID、版本、架构和固定源镜像 digest labels，再使用启动时锁定的 provider 执行隔离探测。Worker 没有归档导入、隐式拉取或 fallback 路径；主服务不会访问 Docker Socket，也不会调用 Docker CLI。

发布流水线使用 BuildKit 为应用镜像和沙箱镜像生成并附加 SPDX SBOM。可按 digest 检查远端 attestation：

```bash
docker buildx imagetools inspect "$SENERA_IMAGE" --format '{{ json .SBOM }}'
docker buildx imagetools inspect "$SENERA_SANDBOX_IMAGE" --format '{{ json .SBOM }}'
```

桌面安装包固定使用 microsandbox；平台运行时由 npm 的可选平台包交付。Linux 源码开发和 Docker 的 `auto` 模式在启动时读取版本化 provider 注册表与宿主能力：KVM 可用时选择 microsandbox；否则在 Docker Engine 已注册 `runsc` 时选择 gVisor；最后选择受限 Docker Engine 容器。三个 provider 默认都允许正常网络访问，工具执行契约显式声明 `Network: Deny` 时才断网。这个选择在启动时锁定；一次工具执行不会在 provider 间切换，也绝不会退回到主机本机执行。

桌面安装包和 Nano 继续内置经过验证的 Microsandbox OCI Bundle，启动时不访问 GitHub Releases。Docker 使用独立 Registry 镜像，不复用 Microsandbox 归档，也不增加应用镜像体积。源码开发需要显式执行 `npm run sandbox.archive` 生成 `Release/SandboxImage`；`npm run dev`、`npm run desktop` 和 `npm run sandbox.prepare` 只消费这个目录。Docker 的下载进度由 Compose/Docker Engine 原生展示，应用侧只报告 Worker 协商和隔离探测状态。

源码高级测试可以在系统配置中显式选择 `Oci` 并声明镜像与 registry 配置。Basic 凭据只引用环境变量名，真实值不会写入配置。`Oci` 与 `ReleaseBundle` 是互斥形状，运行时只执行选中的来源；正式桌面投影固定为随包交付的 `ReleaseBundle`。桌面侧成功导入记录按 `distributionId/archiveVersion/architecture/sha256` 存放在 `MSB_HOME`，与 Senera 产品版本解耦；Docker 投影由 Compose 声明独立 runtime 镜像，不进入这套 Bundle 安装逻辑。

PTY 后台终端也通过同一执行边界路由。资源快照会返回 `requestedBoundary`、`effectiveBoundary`、
`backend`、`capabilities`、`sandboxId` 和审批信息。microsandbox 与 Docker Engine Worker 都支持交互输入和信号；
只有实际后端声明 `resize` 时前端才启用终端尺寸调整。

本地命令、后台进程和 PTY 的环境继承可以统一收敛：

```json
{
  "Defaults": {
    "ToolExecution": {
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

`Set` 最后应用并覆盖同名值。所有 Sandbox provider 都不继承宿主环境，只接收执行画像和调用显式投影的变量。

唯一的 `compose.yaml` 不再传递 `/dev/kvm` 或 `NET_ADMIN`。主服务以非 root 用户运行；仅隔离 Worker 能访问 Docker Engine Socket。管理员可在宿主预先安装并注册 `runsc` 以获得更强的 gVisor 隔离；未注册时使用受限 Docker Engine 容器。容器不会擅自修改宿主守护进程配置。

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

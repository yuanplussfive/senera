# Senera 部署与运维

这份文档写给实际部署、更新和排查 Senera 的人。日常本地开发看 README 就够了；跑 Docker、更新镜像、处理数据目录权限和沙箱状态时，看这里。

## 会话历史维护

新的 Pi 诊断事件在持久化前会被投影为轻量历史 span。已有数据库可以显式分析和压缩，不会把昂贵维护偷偷放进服务启动链路。

```powershell
npm run maintenance.sessions
npm run maintenance.sessions.apply
npm run maintenance.sessions.vacuum
```

默认命令只分析。apply 使用行数和字节数双重有界的批事务重写可压缩 `pi.trace`，每个写批次后执行 WAL checkpoint，不会删除对话、运行快照、step trace 或非 Pi 事件。apply 和 vacuum 应在 Senera 服务停止时执行。`maintenance.sessions.json` 输出机器可读分析结果。

## Artifact 维护

服务运行期间会按 `Artifacts.MaintenanceIntervalMinutes` 自动执行 artifact 保留、总量配额和半成品回收。目录扫描使用 `Artifacts.MaintenanceMaxConcurrency` 控制文件系统并发，默认值为 4，避免大量 artifact 同时打开过多文件句柄。需要手动检查时，默认命令只分析，不删除文件：

```powershell
npm run maintenance.artifacts
npm run maintenance.artifacts.json
```

确认报告后使用 `npm run maintenance.artifacts.apply` 执行清理。工作区、配置文件或 artifact 根目录不在默认位置时，可传 `--workspace`、`--config` 或 `--root`。

自定义参数需要使用当前 npm 版本要求的双分隔符，例如：

```powershell
npm run maintenance.sessions -- -- --database=E:\data\senera.db --batch-size=100 --max-transaction-mib=16
```

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

默认容器监听 `8787`，所有运行数据都放在容器内的 `/data`。`compose.yaml` 默认使用 Docker named volume，普通部署不用先处理宿主机目录权限。

```bash
docker compose run --rm -it senera node Dist/Apps/AdminAccess.js init
docker compose up -d
docker compose logs -f senera
```

第一条命令只在首次使用新的数据 volume 时执行；已有管理员账户时跳过。初始化完成并启动后打开 `http://localhost:8787`。

### 原生 SQLite 依赖

Docker 镜像运行的是标准 Node.js 22，不是 Electron，因此不需要安装系统 `sqlite3` 命令，也不需要执行 Electron ABI 重建。应用使用的 SQLite 驱动是 npm 依赖 `better-sqlite3`；镜像构建会在跳过依赖安装脚本后，使用镜像内的编译工具为 Node ABI 构建该原生模块，并在裁剪生产依赖后运行 SQLite smoke test。桌面端则由 Electron 打包流程单独准备自己的原生模块。

默认 `compose.yaml` 做了这些事情：

- `senera-data:/data`：配置、数据库、会话、用户插件、沙箱运行目录都在这里。
- `${SENERA_PORT:-8787}:8787`：默认宿主机端口是 `8787`。
- `/dev/kvm:/dev/kvm`：Linux 主机上给 microsandbox 使用硬件虚拟化。

镜像内置的用户插件会在容器启动时同步到 `/data/Plugins`。该目录属于数据卷，插件的
`PluginConfig.toml` 会保留用户修改；放入该目录的自定义插件也不会被启动同步清理。

如果服务器上 `8787` 已被占用，可以这样启动：

```bash
SENERA_PORT=18787 docker compose up -d
```

## 管理员访问

Senera 的公网服务是单管理员模式，不提供默认账号或默认密码。首次启动前需要在数据 volume 中创建管理员账户；账户文件只保存 `scrypt` 密码哈希，不保存明文密码。

```bash
docker compose run --rm -it senera node Dist/Apps/AdminAccess.js init
```

命令会依次询问登录用户名、显示名称和管理员密码。登录用户名用于认证，显示名称只用于界面展示。初始化完成后再启动服务：

```bash
docker compose up -d
```

浏览器和手机 Web 端登录后会获得 HttpOnly Cookie。会话最长 72 小时，连续 12 小时没有实际请求会失效；服务重启也会使所有会话重新登录。退出登录或重置密码会立即撤销会话。

忘记密码时，必须在部署机器上执行重置命令。它会更新密码哈希；重启服务后原有会话不再有效：

```bash
docker compose run --rm -it senera node Dist/Apps/AdminAccess.js reset-password
docker compose restart senera
```

本机源码运行时使用同一套命令：

```bash
npm run access.admin -- init --workspace .
```

桌面端不显示管理员登录页，它只绑定本机 loopback 运行时。

## 本机与公网

`compose.yaml` 默认只把端口发布到宿主机 `127.0.0.1`，适合在本机浏览器访问：

```bash
http://localhost:8787
```

本机发布会自动允许 `localhost` 和 `127.0.0.1` 的 HTTP Origin；这只是为了本机使用，不能当作公网 TLS 的替代方案。

公网部署应让 HTTPS/WSS 反向代理面向互联网，Senera 容器保持在代理后面。需要显式设置发布地址和允许 Origin：

```bash
SENERA_BIND_ADDRESS=0.0.0.0 \
SENERA_ALLOWED_ORIGINS=https://senera.example.com \
docker compose up -d
```

远程服务不接受明文 HTTP 登录。若 TLS 在反向代理终止，配置中的 `Server.AccessControl.TrustedProxyAddresses` 只能填写实际代理的内部地址，不能信任任意 `X-Forwarded-Proto` 请求头。不要直接将容器端口暴露给公网。

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

普通更新：

```bash
docker compose pull
docker compose up -d
```

数据会继续留在 Compose 里的 `senera-data` volume。实际 volume 名称可以用 `docker volume ls` 查看。大版本升级前建议备份：

```bash
docker compose exec -T senera tar czf - -C /data . > senera-data-backup.tgz
```

如果你改成了 `./docker-data:/data`，直接备份 `docker-data/` 目录即可。

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

容器回退应直接固定上一完整版本，而不是重新标记源码：

```yaml
image: ghcr.io/<owner>/senera:1.2.3
```

修改部署版本后重新拉取并启动：

```bash
docker compose pull
docker compose up -d
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

Senera 启动时会尝试准备 microsandbox。准备成功时，外部插件可以走更强隔离；如果主机不支持或者准备失败，系统会进入 fallback 状态，服务仍然会继续运行。

PTY 后台终端也通过同一执行边界路由。资源快照会返回 `requestedBoundary`、`effectiveBoundary`、
`backend`、`capabilities`、`sandboxId` 和回退审批信息。microsandbox 当前支持交互输入和信号，但 SDK
未提供程序化终端 resize 时不会声明 `resize`，前端会自动禁用该操作。

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

`Set` 最后应用并覆盖同名值。microsandbox 不继承宿主环境，只接收执行画像和调用显式投影的变量。

Linux 主机要使用更强隔离，通常需要：

```yaml
devices:
  - /dev/kvm:/dev/kvm
cap_add:
  - NET_ADMIN
```

如果你的机器没有 `/dev/kvm`，可以移除这段设备映射，或者换到支持硬件虚拟化的宿主机。

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

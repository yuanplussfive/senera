# Senera 部署与运维

这份文档写给实际部署、更新和排查 Senera 的人。日常本地开发看 README 就够了；跑 Docker、更新镜像、处理数据目录权限和沙箱状态时，看这里。

## Docker 启动

默认容器监听 `8787`，所有运行数据都放在容器内的 `/data`。`compose.yaml` 默认使用 Docker named volume，普通部署不用先处理宿主机目录权限。

```bash
docker compose up -d
docker compose logs -f senera
```

启动后打开 `http://localhost:8787`。

默认 `compose.yaml` 做了这些事情：

- `senera-data:/data`：配置、数据库、会话、沙箱运行目录都在这里。
- `${SENERA_PORT:-8787}:8787`：默认宿主机端口是 `8787`。
- `/dev/kvm:/dev/kvm`：Linux 主机上给 microsandbox 使用硬件虚拟化。

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
- 合并发布 PR：自动更新根 `package.json`、`package-lock.json` 和 `CHANGELOG.md`，随后创建 `vX.Y.Z` 标签与草稿 GitHub Release。
- 产品发布：`Product Release` 从该标签检出源码，验证标签与根包版本一致，然后并行构建桌面安装包和容器镜像；全部成功后才公开 Release 并标记为 latest。

提交类型决定 SemVer 变化：

- `fix:` 发布 patch；
- `feat:` 发布 minor；
- `feat!:` 或正文中的 `BREAKING CHANGE:` 发布 major；
- `docs:`、`test:`、`chore:` 默认不单独推进产品版本。

提交标题必须使用 Conventional Commit 的英文类型和半角冒号，说明文字可以使用中文。例如 `fix: 修复 Windows 沙箱启动失败`、`feat: 增加管理员登录`、`refactor: 拆分配置变更控制器`。不要使用裸中文标题或全角冒号（如 `修复：...`）；Verify 会校验本次提交范围，避免 Release Please 静默跳过版本发布。

Release Please 创建的 PR 需要正常通过 Verify。仓库应配置 `RELEASE_PLEASE_TOKEN`，使用可触发 Pull Request 工作流的 GitHub App token 或细粒度 PAT；未配置时工作流会回退到 `GITHUB_TOKEN`，但 GitHub 不会为该 token 创建的后续事件再次触发工作流。

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

桌面端回退和数据兼容要求见 [升级指南](Upgrading.md)。

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

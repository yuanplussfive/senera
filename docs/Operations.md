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

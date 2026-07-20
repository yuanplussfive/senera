# 更新记录

这里记录 Senera 每个正式版本中用户能够感知的新增功能、问题修复和兼容性变化。

从下一个版本开始，本文件由 Release Please 根据 Conventional Commits 自动维护。内部测试、格式调整和无用户影响的维护工作默认不会进入发布说明。

## [1.3.1](https://github.com/yuanplussfive/senera/compare/v1.3.0...v1.3.1) (2026-07-20)


### 问题修复

* **ci:** prevent invalid squash commit titles ([#31](https://github.com/yuanplussfive/senera/issues/31)) ([ae43787](https://github.com/yuanplussfive/senera/commit/ae437877adfc1f951199aa5c6d3b1836a0e43feb))

## [1.3.0](https://github.com/yuanplussfive/senera/compare/v1.2.0...v1.3.0) (2026-07-20)


### 新增功能

* **frontend:** 重构 Agent 工作区、设置体验与桌面交互 ([#27](https://github.com/yuanplussfive/senera/issues/27)) ([f3ca594](https://github.com/yuanplussfive/senera/commit/f3ca594a70d33cbdad134c850544eb8347cb14b6))


### 问题修复

* **ci:** allow autofix coauthor in squash commits ([#28](https://github.com/yuanplussfive/senera/issues/28)) ([507b8bc](https://github.com/yuanplussfive/senera/commit/507b8bc2da5495d4924bf4b64b2c72559f34d1c2))

## [1.2.0](https://github.com/yuanplussfive/senera/compare/v1.1.0...v1.2.0) (2026-07-14)


### 新增功能

* **runtime:** 强化持久化重试与文件边界 ([#25](https://github.com/yuanplussfive/senera/issues/25)) ([06b26d0](https://github.com/yuanplussfive/senera/commit/06b26d07204c7b9ab5714c2d5fe5d7b45cf725f6))

## [1.1.0](https://github.com/yuanplussfive/senera/compare/v1.0.27...v1.1.0) (2026-07-14)


### 新增功能

* **uploads:** 完善上传治理与运行时可靠性 ([#23](https://github.com/yuanplussfive/senera/issues/23)) ([ca53adb](https://github.com/yuanplussfive/senera/commit/ca53adb095c611cc747d8353561d95a49b09641f))

## [1.0.27](https://github.com/yuanplussfive/senera/compare/v1.0.26...v1.0.27) (2026-07-14)


### 问题修复

* **release:** 补发模型服务工作台版本 ([#21](https://github.com/yuanplussfive/senera/issues/21)) ([d6adc41](https://github.com/yuanplussfive/senera/commit/d6adc411e615f7589d20a64a0fd7d39eaaaaa8ed))

## [1.0.26](https://github.com/yuanplussfive/senera/compare/v1.0.25...v1.0.26) (2026-07-12)


### 问题修复

* **release:** 指定发布仓库上下文 ([#16](https://github.com/yuanplussfive/senera/issues/16)) ([220cbde](https://github.com/yuanplussfive/senera/commit/220cbde1ef3f389c635b49fe5e0867ec05620a13))

## [1.0.25](https://github.com/yuanplussfive/senera/compare/v1.0.24...v1.0.25) (2026-07-12)


### 问题修复

* **release:** 允许手动发布继续构建产物 ([#14](https://github.com/yuanplussfive/senera/issues/14)) ([3ece0f6](https://github.com/yuanplussfive/senera/commit/3ece0f69063649d0370d5f672b22e5508ef28a23))

## [1.0.24](https://github.com/yuanplussfive/senera/compare/v1.0.23...v1.0.24) (2026-07-12)


### 问题修复

* **release:** 防止发布提交静默跳过 ([c690a1c](https://github.com/yuanplussfive/senera/commit/c690a1ceeaf21678cceb16455d24de8e58a4206b))


### 文档

* 删除过时升级指南 ([#9](https://github.com/yuanplussfive/senera/issues/9)) ([ba49814](https://github.com/yuanplussfive/senera/commit/ba49814fae1a236eae5d993ed9bfb79dff490f60))

## [1.0.23](https://github.com/yuanplussfive/senera/compare/v1.0.22...v1.0.23) (2026-07-12)


### 问题修复

* **release:** 防止发布提交静默跳过 ([c690a1c](https://github.com/yuanplussfive/senera/commit/c690a1ceeaf21678cceb16455d24de8e58a4206b))


### 文档

* 删除过时升级指南 ([#9](https://github.com/yuanplussfive/senera/issues/9)) ([ba49814](https://github.com/yuanplussfive/senera/commit/ba49814fae1a236eae5d993ed9bfb79dff490f60))

## [1.0.22](https://github.com/yuanplussfive/senera/compare/v1.0.21...v1.0.22) (2026-07-12)


### 问题修复

* **release:** 防止发布提交静默跳过 ([c690a1c](https://github.com/yuanplussfive/senera/commit/c690a1ceeaf21678cceb16455d24de8e58a4206b))

## 1.0.21 - 2026-07-09

### 发布基线

- 将现有 `desktop-v1.0.21` 桌面版本确认为旧发布体系的最终基线。
- 后续版本统一使用根 `package.json` 中的 SemVer，并采用 `vX.Y.Z` Git 标签。
- 历史 `desktop-v1.0.x` 标签继续保留，不重写、不删除。

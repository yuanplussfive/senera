# 更新记录

这里记录 Senera 每个正式版本中用户能够感知的新增功能、问题修复和兼容性变化。

从下一个版本开始，本文件由 Release Please 根据 Conventional Commits 自动维护。内部测试、格式调整和无用户影响的维护工作默认不会进入发布说明。

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

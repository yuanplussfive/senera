# Execution Resource Wait

## 简述

等待后台资源出现新事件、进入终态或达到超时，然后返回游标后的增量快照。

## 何时使用

启动长任务后等待下一批 stdout/stderr，或等待命令完成时使用。根据返回的 `cursor` 继续等待可避免重复输出。

## 不要使用的情况

只需立即检查时使用 ExecutionResourceInspect。不要把超时当作进程失败；超时只表示等待窗口内没有新变化。

## 输入

`resourceId` 指定资源，`cursor` 指定已消费位置，`timeoutMs` 指定最长等待时间并受系统配置上限约束。

## 输出

返回新的状态、游标和增量事件。终态包括 completed、failed 和 cancelled。

## 执行约束

等待由资源状态变化唤醒，不依赖固定间隔轮询；调用取消会中止本次等待，不会隐式终止后台进程。

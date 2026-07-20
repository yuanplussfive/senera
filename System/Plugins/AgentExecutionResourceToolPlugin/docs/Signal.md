# Execution Resource Signal

## 简述

向后台进程树发送 interrupt、terminate 或 kill 信号，并返回发送后的资源快照。

## 何时使用

先用 interrupt 请求正常停止；无响应时使用 terminate；只有进程拒绝退出时才使用 kill。

## 不要使用的情况

不要把 signal 当作等待完成的替代品。进程可能在信号发送与检查之间退出，应继续使用 ExecutionResourceWait 获取终态。

## 输入

`resourceId` 指定资源，`signal` 为 `interrupt`、`terminate` 或 `kill`。

## 输出

返回当前资源快照。信号控制进程树，最终状态由进程关闭事件确认。

## 执行约束

只能控制当前会话或请求拥有的资源。运行时关闭和资源过期清理会执行有界的 terminate 到 kill 升级。

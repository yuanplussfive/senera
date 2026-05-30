# WeatherTool

## 简述

获取城市或坐标的当前天气。

## 何时使用

用户询问当前天气、温度、风力、是否下雨或天气概况时使用。

## 不要使用的情况

不要用于历史天气、逐小时预报、空气质量、预警或复杂气象分析。缺少地点时用 `AskUserTool`。

## 输入

`location` 或 `latitude`+`longitude` 二选一。`timezone` 默认 `auto`。`temperatureUnit` 默认 `celsius`。`timeoutMs` 可选。

## 输出

返回地点、坐标、时区、温度、风速、风向、天气说明、观测时间和来源。

## 调用示例

<senera_tool_calls>
  <tool_call>
    <name>WeatherTool</name>
    <arguments>
      <location>Shanghai</location>
    </arguments>
  </tool_call>
</senera_tool_calls>

## 执行约束

不要编造天气。工具失败时说明原因，必要时请用户换更明确地点。

# ExpenseSummaryTool

## 简述

汇总多人费用并生成分摊结算。

## 何时使用

用户给出消费记录，并需要总额、分类、付款人、分摊或结算建议时使用。

## 不要使用的情况

不要查询银行、发票、汇率、税务或支付状态。缺少费用条目时先追问。

## 输入

`currency` 支持 `CNY`、`USD`、`EUR`。`roundingMode` 可选。`transactions.item` 必填，含 title、amount、category、paidBy、participants。

## 输出

返回总额、分类汇总、付款人汇总、个人余额和结算方向。

## 调用示例

```xml
<tool_calls>
  <tool_call>
    <name>ExpenseSummaryTool</name>
    <arguments>
      <currency>CNY</currency>
      <roundingMode>nearest_cent</roundingMode>
      <transactions>
        <item>
          <title>Lunch</title>
          <amount>120</amount>
          <category>food</category>
          <paidBy>Alice</paidBy>
          <participants>
            <item>
              <name>Alice</name>
              <weight>1</weight>
            </item>
            <item>
              <name>Bob</name>
              <weight>1</weight>
            </item>
          </participants>
        </item>
      </transactions>
    </arguments>
  </tool_call>
</tool_calls>
```

## 执行约束

金额为正数。participants 至少一项，weight 大于 0。数组用重复 `<item>`。

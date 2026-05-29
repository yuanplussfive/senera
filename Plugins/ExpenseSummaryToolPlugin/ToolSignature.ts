export type ExpenseSummaryToolArguments = {
  // 币种。当前支持 CNY、USD、EUR；默认 CNY。
  currency?: "CNY" | "USD" | "EUR"

  // 金额舍入规则；默认 nearest_cent。
  roundingMode?: "nearest_cent" | "up_cent" | "down_cent"

  // 费用流水数组，至少 1 项。
  transactions: {
    item: Array<{
      // 交易标题，例如 Lunch、Taxi、Hotel。
      title: string

      // 正数金额。
      amount: number

      // 费用分类。
      category: "transport" | "lodging" | "food" | "tickets" | "supplies" | "other"

      // 实际付款人名称。
      paidBy: string

      // 参与分摊人数组；每项包含姓名和权重。
      participants: {
        item: Array<{
          name: string
          weight?: number
        }>
      }

      // 可选标签数组。
      tags?: {
        item: string[]
      }
    }>
  }
}

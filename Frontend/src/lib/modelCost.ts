import type { AgentModelCost } from "../../../Source/AgentSystem/ModelEndpoints/AgentModelPricing";

/** Preserve small charges without displaying long, misleading precision. */
export function formatModelCost(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value) || value < 0) return "—";
  return `$${value.toLocaleString("en-US", { minimumSignificantDigits: 2, maximumSignificantDigits: 2, useGrouping: false })}`;
}

export function formatModelCharge(cost: AgentModelCost | undefined): string {
  const amount = formatModelCost(cost?.total);
  return amount === "—" || cost?.totalFromProvider === true ? amount : `≈${amount}`;
}

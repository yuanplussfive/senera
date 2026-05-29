export type AgentTextPredicate =
  | {
      kind: "starts_with";
      value: string;
    }
  | {
      kind: "includes";
      value: string;
    };

export function matchesTextRule(
  text: string,
  predicate: AgentTextPredicate,
): boolean {
  return ({
    starts_with: () => text.startsWith(predicate.value),
    includes: () => text.includes(predicate.value),
  })[predicate.kind]();
}

export function matchesEveryTextRule(
  text: string,
  predicates: readonly AgentTextPredicate[],
): boolean {
  return predicates.every((predicate) => matchesTextRule(text, predicate));
}

export function matchesSomeTextRule(
  text: string,
  predicates: readonly AgentTextPredicate[],
): boolean {
  return predicates.some((predicate) => matchesTextRule(text, predicate));
}

import { InlineError } from "../../../shared/ui";

export function ProviderFormError({ message }: { message: string }): JSX.Element {
  return <InlineError className="mt-2">{message}</InlineError>;
}

import { Check, CircleStop, ExternalLink, LoaderCircle, MessageSquareText, ShieldAlert, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import type {
  InteractionInputAction,
  InteractionInputContent,
  InteractionInputProperty,
  InteractionInputValue,
} from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import type { InteractionInputRunRecord } from "../../store/sessionStore";
import { Button, MetaLabel } from "../../shared/ui";
import { openExternalUrl } from "../../app/desktopBridge";

export interface InteractionInputStripProps {
  interactions: InteractionInputRunRecord[];
  disabled?: boolean;
  onResolve: (interactionId: string, action: InteractionInputAction, content?: InteractionInputContent) => void;
}

type InteractionDraft = Record<string, InteractionInputValue | undefined>;

export function InteractionInputStrip({
  interactions,
  disabled = false,
  onResolve,
}: InteractionInputStripProps): JSX.Element | null {
  const pending = interactions.filter(
    (interaction) => interaction.status === "pending" || interaction.status === "external_pending",
  );
  if (pending.length === 0) return null;
  return (
    <div className="mb-3 flex flex-col gap-2">
      {pending.map((interaction) => (
        <InteractionInputItem
          key={interaction.interactionId}
          interaction={interaction}
          disabled={disabled || interaction.resolutionPending === true}
          onResolve={onResolve}
        />
      ))}
    </div>
  );
}

function InteractionInputItem({
  interaction,
  disabled,
  onResolve,
}: {
  interaction: InteractionInputRunRecord;
  disabled: boolean;
  onResolve: InteractionInputStripProps["onResolve"];
}): JSX.Element {
  return interaction.mode === "url" ? (
    <UrlInteractionInputItem interaction={interaction} disabled={disabled} onResolve={onResolve} />
  ) : (
    <FormInteractionInputItem interaction={interaction} disabled={disabled} onResolve={onResolve} />
  );
}

function FormInteractionInputItem({
  interaction,
  disabled,
  onResolve,
}: {
  interaction: Extract<InteractionInputRunRecord, { mode: "form" }>;
  disabled: boolean;
  onResolve: InteractionInputStripProps["onResolve"];
}): JSX.Element {
  const [draft, setDraft] = useState<InteractionDraft>(() => initialDraft(interaction));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const required = useMemo(() => new Set(interaction.schema.required ?? []), [interaction.schema.required]);

  const submit = (): void => {
    const issues = validateDraft(interaction, draft);
    setErrors(issues);
    if (Object.keys(issues).length > 0) return;
    onResolve(interaction.interactionId, "accept", compactDraft(draft));
  };

  return (
    <section className="border-l-2 border-cyan-600 bg-paper-50 px-3 py-2.5 shadow-[inset_0_-1px_0_rgba(24,24,27,0.05),0_1px_2px_rgba(24,24,27,0.04)]">
      <div className="flex items-start gap-2.5">
        <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0 text-cyan-700" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-[12.5px] font-medium text-ink-900">{interaction.toolName}</span>
            <MetaLabel size="sm" className="text-cyan-700">
              {frontendMessage("interaction.input.pending")}
            </MetaLabel>
          </div>
          <p className="mt-0.5 text-[12px] leading-5 text-ink-600">{interaction.message}</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {Object.entries(interaction.schema.properties).map(([name, property]) => (
              <InteractionField
                key={name}
                name={name}
                property={property}
                required={required.has(name)}
                value={draft[name]}
                error={errors[name]}
                disabled={disabled}
                onChange={(value) => {
                  setDraft((current) => ({ ...current, [name]: value }));
                  setErrors((current) => {
                    if (!current[name]) return current;
                    const next = { ...current };
                    delete next[name];
                    return next;
                  });
                }}
              />
            ))}
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <ResolveButton
              action="accept"
              pendingAction={interaction.pendingAction}
              disabled={disabled}
              onClick={submit}
            />
            <ResolveButton
              action="decline"
              pendingAction={interaction.pendingAction}
              disabled={disabled}
              onClick={() => onResolve(interaction.interactionId, "decline")}
            />
            <ResolveButton
              action="cancel"
              pendingAction={interaction.pendingAction}
              disabled={disabled}
              onClick={() => onResolve(interaction.interactionId, "cancel")}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function UrlInteractionInputItem({
  interaction,
  disabled,
  onResolve,
}: {
  interaction: Extract<InteractionInputRunRecord, { mode: "url" }>;
  disabled: boolean;
  onResolve: InteractionInputStripProps["onResolve"];
}): JSX.Element {
  const [opening, setOpening] = useState(false);
  const waitingForCompletion = interaction.status === "external_pending";
  const open = async (): Promise<void> => {
    setOpening(true);
    try {
      const result = await openExternalUrl(interaction.url);
      if (result === "blocked") {
        toast.error(frontendMessage("interaction.input.externalOpenFailed"));
        return;
      }
      onResolve(interaction.interactionId, "accept");
    } finally {
      setOpening(false);
    }
  };

  return (
    <section className="border-l-2 border-cyan-600 bg-paper-50 px-3 py-2.5 shadow-[inset_0_-1px_0_rgba(24,24,27,0.05),0_1px_2px_rgba(24,24,27,0.04)]">
      <div className="flex items-start gap-2.5">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-cyan-700" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-[12.5px] font-medium text-ink-900">{interaction.toolName}</span>
            <MetaLabel size="sm" className="text-cyan-700">
              {frontendMessage(
                waitingForCompletion ? "interaction.input.externalPending" : "interaction.input.externalRequired",
              )}
            </MetaLabel>
          </div>
          <p className="mt-0.5 text-[12px] leading-5 text-ink-600">{interaction.message}</p>
          <div className="mt-2 border border-ink-200 bg-white px-2.5 py-2">
            <div className="text-[11px] font-medium text-ink-800">{interaction.hostname}</div>
            <div className="mt-0.5 break-all font-mono text-[10px] leading-4 text-ink-500">{interaction.url}</div>
          </div>
          <p className="mt-1.5 text-[10.5px] leading-4 text-ink-500">
            {frontendMessage("interaction.input.externalWarning")}
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {waitingForCompletion ? (
              <span className="inline-flex h-7 items-center gap-1.5 px-1 text-[11.5px] text-cyan-700">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                {frontendMessage("interaction.input.externalWaiting")}
              </span>
            ) : (
              <Button
                size="sm"
                disabled={disabled || opening}
                onClick={() => void open()}
                className="h-7 bg-ink-900 px-2 text-paper-50 hover:bg-ink-800"
              >
                {opening ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
                {frontendMessage(opening ? "interaction.input.externalOpening" : "interaction.input.externalOpen")}
              </Button>
            )}
            {!waitingForCompletion ? (
              <ResolveButton
                action="decline"
                pendingAction={interaction.pendingAction}
                disabled={disabled}
                onClick={() => onResolve(interaction.interactionId, "decline")}
              />
            ) : null}
            <ResolveButton
              action="cancel"
              pendingAction={interaction.pendingAction}
              disabled={disabled}
              onClick={() => onResolve(interaction.interactionId, "cancel")}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function InteractionField({
  name,
  property,
  required,
  value,
  error,
  disabled,
  onChange,
}: {
  name: string;
  property: InteractionInputProperty;
  required: boolean;
  value: InteractionInputValue | undefined;
  error?: string;
  disabled: boolean;
  onChange: (value: InteractionInputValue | undefined) => void;
}): JSX.Element {
  const label = property.title || name;
  return (
    <label className="min-w-0 text-[11.5px] text-ink-700">
      <span className="mb-1 block font-medium">
        {label}
        {required ? <span className="ml-0.5 text-brick-600">*</span> : null}
      </span>
      <InteractionControl property={property} value={value} disabled={disabled} onChange={onChange} />
      {property.description ? <span className="mt-1 block text-[10.5px] leading-4 text-ink-400">{property.description}</span> : null}
      {error ? <span className="mt-1 block text-[10.5px] text-brick-700">{error}</span> : null}
    </label>
  );
}

function InteractionControl({
  property,
  value,
  disabled,
  onChange,
}: {
  property: InteractionInputProperty;
  value: InteractionInputValue | undefined;
  disabled: boolean;
  onChange: (value: InteractionInputValue | undefined) => void;
}): JSX.Element {
  const className =
    "h-8 w-full border border-ink-200 bg-white px-2 text-[12px] text-ink-900 outline-none focus:border-cyan-600 disabled:bg-ink-50";
  if (property.type === "boolean") {
    return (
      <input
        type="checkbox"
        checked={value === true}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-cyan-700"
      />
    );
  }
  if (property.type === "array") {
    const selected = Array.isArray(value) ? value : [];
    return (
      <div className="flex min-h-8 flex-wrap gap-x-3 gap-y-1 border border-ink-200 bg-white px-2 py-1.5">
        {multiSelectOptions(property).map((option) => (
          <span key={option.value} className="flex items-center gap-1.5 whitespace-nowrap text-[11px]">
            <input
              type="checkbox"
              checked={selected.includes(option.value)}
              disabled={disabled}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...selected, option.value]
                    : selected.filter((item) => item !== option.value),
                )
              }
              className="h-3.5 w-3.5 accent-cyan-700"
            />
            {option.label}
          </span>
        ))}
      </div>
    );
  }
  if (property.type === "number" || property.type === "integer") {
    return (
      <input
        type="number"
        value={typeof value === "number" ? value : ""}
        min={property.minimum}
        max={property.maximum}
        step={property.type === "integer" ? 1 : "any"}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value === "" ? undefined : Number(event.target.value))}
        className={className}
      />
    );
  }
  const options = singleSelectOptions(property);
  if (options.length > 0) {
    return (
      <select
        value={typeof value === "string" ? value : ""}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={className}
      >
        <option value="">{frontendMessage("interaction.input.select")}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      type={inputType(property.format)}
      value={typeof value === "string" ? value : ""}
      minLength={property.minLength}
      maxLength={property.maxLength}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className={className}
    />
  );
}

function ResolveButton({
  action,
  pendingAction,
  disabled,
  onClick,
}: {
  action: InteractionInputAction;
  pendingAction?: InteractionInputAction;
  disabled: boolean;
  onClick: () => void;
}): JSX.Element {
  const presentation = interactionActionPresentation[action];
  const resolving = pendingAction === action;
  const Icon = resolving ? LoaderCircle : presentation.Icon;
  return (
    <Button
      size="sm"
      variant={presentation.variant}
      disabled={disabled}
      onClick={onClick}
      className={presentation.className}
    >
      <Icon className={`h-3.5 w-3.5${resolving ? " animate-spin" : ""}`} />
      {frontendMessage(resolving ? "interaction.input.resolving" : presentation.label)}
    </Button>
  );
}

const interactionActionPresentation = {
  accept: {
    Icon: Check,
    variant: "default",
    className: "h-7 bg-ink-900 px-2 text-paper-50 hover:bg-ink-800",
    label: "interaction.input.submit",
  },
  decline: {
    Icon: X,
    variant: "ghost",
    className: "h-7 px-2 text-ink-600 hover:bg-ink-100",
    label: "interaction.input.decline",
  },
  cancel: {
    Icon: CircleStop,
    variant: "ghost",
    className: "h-7 px-2 text-brick-700 hover:bg-brick-50",
    label: "interaction.input.cancel",
  },
} as const;

function initialDraft(interaction: Extract<InteractionInputRunRecord, { mode: "form" }>): InteractionDraft {
  return Object.fromEntries(
    Object.entries(interaction.schema.properties).map(([name, property]) => [
      name,
      property.default ?? (property.type === "boolean" ? false : property.type === "array" ? [] : undefined),
    ]),
  );
}

function compactDraft(draft: InteractionDraft): InteractionInputContent {
  return Object.fromEntries(Object.entries(draft).filter((entry): entry is [string, InteractionInputValue] => entry[1] !== undefined));
}

function validateDraft(
  interaction: Extract<InteractionInputRunRecord, { mode: "form" }>,
  draft: InteractionDraft,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const required = new Set(interaction.schema.required ?? []);
  for (const [name, property] of Object.entries(interaction.schema.properties)) {
    const value = draft[name];
    if (required.has(name) && isEmpty(value)) {
      errors[name] = frontendMessage("interaction.input.required");
      continue;
    }
    if (value === undefined) continue;
    const issue = validateProperty(property, value);
    if (issue) errors[name] = issue;
  }
  return errors;
}

function validateProperty(property: InteractionInputProperty, value: InteractionInputValue): string | undefined {
  if (property.type === "string" && typeof value === "string") {
    if (property.minLength !== undefined && value.length < property.minLength) return frontendMessage("interaction.input.tooShort");
    if (property.maxLength !== undefined && value.length > property.maxLength) return frontendMessage("interaction.input.tooLong");
  }
  if ((property.type === "number" || property.type === "integer") && typeof value === "number") {
    if (!Number.isFinite(value) || (property.type === "integer" && !Number.isInteger(value))) return frontendMessage("interaction.input.invalidNumber");
    if (property.minimum !== undefined && value < property.minimum) return frontendMessage("interaction.input.tooSmall", { value: property.minimum });
    if (property.maximum !== undefined && value > property.maximum) return frontendMessage("interaction.input.tooLarge", { value: property.maximum });
  }
  if (property.type === "array" && Array.isArray(value)) {
    if (property.minItems !== undefined && value.length < property.minItems) return frontendMessage("interaction.input.tooFew");
    if (property.maxItems !== undefined && value.length > property.maxItems) return frontendMessage("interaction.input.tooMany");
  }
  return undefined;
}

function isEmpty(value: InteractionInputValue | undefined): boolean {
  return value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
}

function singleSelectOptions(property: Extract<InteractionInputProperty, { type: "string" }>) {
  if (property.oneOf) return property.oneOf.map((option) => ({ value: option.const, label: option.title }));
  return (property.enum ?? []).map((value, index) => ({ value, label: property.enumNames?.[index] ?? value }));
}

function multiSelectOptions(property: Extract<InteractionInputProperty, { type: "array" }>) {
  if (property.items.anyOf) return property.items.anyOf.map((option) => ({ value: option.const, label: option.title }));
  return (property.items.enum ?? []).map((value) => ({ value, label: value }));
}

function inputType(format: Extract<InteractionInputProperty, { type: "string" }>["format"]): string {
  if (format === "date-time") return "datetime-local";
  return format === "email" || format === "date" ? format : "text";
}

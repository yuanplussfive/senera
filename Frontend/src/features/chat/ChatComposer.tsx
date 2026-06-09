import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Check, ChevronDown, Paperclip, Square } from "lucide-react";
import type { ModelProviderListItem } from "../../api/eventTypes";
import { cn } from "../../lib/util";
import { useResponsiveMode } from "../../shared/responsive";
import { MotionButton } from "../../shared/motion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Tooltip,
} from "../../shared/ui";
import { ModelProviderIcon } from "./ModelProviderIcon";
import { readSelectedModelProvider } from "./modelProvider";

const DESKTOP_TEXTAREA_MAX_HEIGHT = 240;
const TOUCH_TEXTAREA_MAX_HEIGHT = 160;

interface ChatComposerProps {
  disabled: boolean;
  running: boolean;
  modelProviders: ModelProviderListItem[];
  selectedModelProviderId: string | null;
  onSelectModelProvider: (id: string) => void;
  socketStatus: string;
  onSend: (input: string) => void;
  onCancel: () => void;
}

export function ChatComposer({
  disabled,
  running,
  modelProviders,
  selectedModelProviderId,
  onSelectModelProvider,
  socketStatus,
  onSend,
  onCancel,
}: ChatComposerProps): JSX.Element {
  const [value, setValue] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const { prefersCompactControls } = useResponsiveMode();
  const textareaMaxHeight = prefersCompactControls ? TOUCH_TEXTAREA_MAX_HEIGHT : DESKTOP_TEXTAREA_MAX_HEIGHT;

  const hint = useMemo(() => {
    if (running) return prefersCompactControls ? "正在思考" : "正在思考——可按 Esc 中断";
    if (socketStatus === "open") return "跟 senera 说点什么";
    if (socketStatus === "connecting" || socketStatus === "idle") return "正在连接后端…";
    return "后端未连接，请检查服务";
  }, [prefersCompactControls, socketStatus, running]);

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        taRef.current?.focus();
        return;
      }
      if (e.key === "Escape" && running) {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [running, onCancel]);

  useEffect(() => {
    if (!taRef.current) return;
    const el = taRef.current;
    el.style.height = "auto";
    el.style.height = value ? `${Math.min(el.scrollHeight, textareaMaxHeight)}px` : "auto";
  }, [textareaMaxHeight, value]);

  const submit = (): void => {
    const text = value.trim();
    if (!text || disabled || running) return;
    onSend(text);
    setValue("");
    if (taRef.current) taRef.current.style.height = "auto";
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    setValue(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, textareaMaxHeight)}px`;
  };

  const canSend = !disabled && !running && value.trim().length > 0;

  return (
    <div className="border-t border-ink-200/60 bg-paper-50 px-3 pb-4 pt-3 sm:px-6 sm:pb-6">
      <div
        className={cn(
          "mx-auto flex max-w-3xl flex-col gap-1.5 rounded-2xl border border-ink-200 bg-paper-100/80 px-3 py-2 shadow-bubble-ai transition",
          "focus-within:border-ink-300 focus-within:bg-paper-50",
        )}
      >
        <div className="flex items-end gap-2">
          <IconButton
            label="attach"
            tooltip="附加文件（待接入）"
            tooltipSide="top"
            size="lg"
            tone="primary"
            disabled={running}
          >
            <Paperclip className="h-4 w-4" />
          </IconButton>
          <textarea
            ref={taRef}
            value={value}
            rows={1}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={hint}
            disabled={running}
            style={{ maxHeight: textareaMaxHeight }}
            className="scrollbar-thin min-w-0 flex-1 resize-none bg-transparent py-2 text-[14.5px] leading-6 text-ink-900 placeholder:text-ink-400 focus:outline-none disabled:opacity-60"
          />
          {running ? (
            <Tooltip content="中断当前运行" side="top" shortcut={prefersCompactControls ? undefined : "Esc"}>
              <MotionButton
                onClick={onCancel}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brick-500 text-paper-50 transition hover:bg-brick-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra-200/70 disabled:pointer-events-none disabled:opacity-50"
                aria-label="cancel"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
              </MotionButton>
            </Tooltip>
          ) : (
            <Tooltip content="发送" side="top" shortcut={prefersCompactControls ? undefined : "↵"}>
              <MotionButton
                onClick={submit}
                disabled={!canSend}
                className={cn(
                  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra-200/70 disabled:pointer-events-none disabled:opacity-50",
                  canSend ? "bg-ink-900 text-paper-50 hover:bg-terra-500" : "bg-ink-200/60 text-ink-400",
                )}
                aria-label="send"
              >
                <ArrowUp className="h-4 w-4" />
              </MotionButton>
            </Tooltip>
          )}
        </div>
        <div className="flex min-w-0 items-center justify-between gap-2 px-1 font-mono text-[10.5px] text-ink-400">
          <span className="min-w-0 truncate">
            {prefersCompactControls ? null : running ? (
              <>
                <kbd className="rounded border border-ink-200 bg-paper-50 px-1 text-ink-600">Esc</kbd>
                <span className="ml-1.5">中断当前运行</span>
              </>
            ) : (
              <>
                <kbd className="rounded border border-ink-200 bg-paper-50 px-1 text-ink-600">⌘K</kbd>
                <span className="ml-1.5">聚焦输入</span>
                <span className="mx-2 text-ink-300">·</span>
                <kbd className="rounded border border-ink-200 bg-paper-50 px-1 text-ink-600">⇧↵</kbd>
                <span className="ml-1.5">换行</span>
              </>
            )}
          </span>
          <ModelSelector
            disabled={disabled || running}
            models={modelProviders}
            selectedId={selectedModelProviderId}
            onSelect={onSelectModelProvider}
          />
        </div>
      </div>
    </div>
  );
}

function ModelSelector({
  disabled,
  models,
  selectedId,
  onSelect,
}: {
  disabled: boolean;
  models: ModelProviderListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}): JSX.Element {
  const selected = useMemo(
    () => readSelectedModelProvider(models, selectedId) ?? null,
    [models, selectedId],
  );
  const label = selected?.title ?? selected?.model ?? "...";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled || models.length === 0}>
        <MotionButton
          className={cn(
            "inline-flex h-9 min-w-0 max-w-[180px] items-center gap-1.5 rounded-md px-2 text-[11px] sm:h-7 sm:max-w-[230px]",
            "text-ink-500 transition hover:bg-ink-900/[0.045] hover:text-ink-800",
            "focus:outline-none focus:ring-2 focus:ring-terra-200/60",
            (disabled || models.length === 0) && "pointer-events-none opacity-55",
          )}
          aria-label="选择模型"
        >
          <ModelProviderIcon
            className="shrink-0"
            icon={selected?.icon}
            size={14}
          />
          <span className="truncate">{label}</span>
          <ChevronDown className="h-3 w-3 shrink-0 text-ink-350" />
        </MotionButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-[min(280px,calc(100vw-24px))]">
        <DropdownMenuLabel>模型</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {models.map((model) => {
          const active = model.id === selected?.id;
          return (
            <DropdownMenuItem
              key={model.id}
              onSelect={() => onSelect(model.id)}
              className="h-auto items-start py-2"
              icon={active
                ? <Check className="h-3.5 w-3.5 text-terra-500" />
                : (
                  <ModelProviderIcon
                    icon={model.icon}
                    size={14}
                  />
                )}
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-[13px] text-ink-850">{model.title}</span>
                <span className="truncate font-mono text-[10.5px] text-ink-400">
                  {model.endpoint} · {model.model}
                </span>
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

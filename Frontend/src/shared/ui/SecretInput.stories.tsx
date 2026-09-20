import { useState } from "react";
import type { Story } from "@ladle/react";
import { AppIcon } from "./AppIcon";
import { SecretInput } from "./SecretInput";

export const Basic: Story = () => {
  const [value, setValue] = useState("");
  return (
    <main className="min-h-[320px] bg-surface-canvas p-6 text-content-primary sm:p-10">
      <div className="mx-auto max-w-[560px]">
        <h1 className="text-[18px] font-semibold text-content-strong">密钥输入</h1>
        <p className="mt-1 text-[12.5px] leading-5 text-content-muted">
          用于 API Key、Token 等敏感信息输入，支持显示/隐藏切换。
        </p>
        <div className="mt-6">
          <SecretInput value={value} placeholder="sk-..." ariaLabel="API 密钥" onChange={setValue} />
        </div>
      </div>
    </main>
  );
};

export const WithCommit: Story = () => {
  const [draft, setDraft] = useState("");
  const [committed, setCommitted] = useState("");
  return (
    <main className="min-h-[420px] bg-surface-canvas p-6 text-content-primary sm:p-10">
      <div className="mx-auto max-w-[560px]">
        <h1 className="text-[18px] font-semibold text-content-strong">失焦提交模式</h1>
        <p className="mt-1 text-[12.5px] leading-5 text-content-muted">
          失焦或按 Enter 时触发 onBlur 回调，适合配置表单场景。
        </p>
        <div className="mt-6 space-y-4">
          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-content-secondary">MCP 服务密钥</label>
            <SecretInput
              value={draft}
              placeholder="输入密钥后失焦或按 Enter 提交"
              ariaLabel="服务密钥"
              onChange={setDraft}
              onBlur={() => {
                setCommitted(draft);
              }}
            />
          </div>
          <div className="rounded-lg border border-line bg-surface-subtle p-3">
            <div className="text-[11px] font-medium text-content-muted">已提交的值</div>
            <div className="mt-1 font-mono text-[12px] text-content-primary">{committed || "（尚未提交）"}</div>
          </div>
        </div>
      </div>
    </main>
  );
};

export const WithClearButton: Story = () => {
  const [draft, setDraft] = useState("sk-stored-secret-1234567890");
  const [stored, setStored] = useState("sk-stored-secret-1234567890");
  return (
    <main className="min-h-[420px] bg-surface-canvas p-6 text-content-primary sm:p-10">
      <div className="mx-auto max-w-[560px]">
        <h1 className="text-[18px] font-semibold text-content-strong">带清除按钮</h1>
        <p className="mt-1 text-[12.5px] leading-5 text-content-muted">
          已有存储值时显示清除按钮，用户可明确删除已保存的密钥。
        </p>
        <div className="mt-6 space-y-4">
          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-content-secondary">Provider API Key</label>
            <SecretInput
              value={draft}
              placeholder="sk-..."
              ariaLabel="API Key"
              showClearButton={!!stored}
              clearButtonLabel="清除已保存的密钥"
              onChange={setDraft}
              onBlur={() => {
                if (draft !== stored) {
                  setStored(draft);
                }
              }}
              onClear={() => {
                setStored("");
                setDraft("");
              }}
            />
          </div>
          <div className="rounded-lg border border-line bg-surface-subtle p-3">
            <div className="text-[11px] font-medium text-content-muted">存储状态</div>
            <div className="mt-1 font-mono text-[12px] text-content-primary">
              {stored ? `已存储: ${stored.slice(0, 10)}...` : "无存储值"}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
};

export const WithTrailingAction: Story = () => {
  const [value, setValue] = useState("sk-example-key-1234567890");
  return (
    <main className="min-h-[320px] bg-surface-canvas p-6 text-content-primary sm:p-10">
      <div className="mx-auto max-w-[560px]">
        <h1 className="text-[18px] font-semibold text-content-strong">带尾部操作</h1>
        <div className="mt-6">
          <SecretInput
            value={value}
            ariaLabel="可粘贴的 API 密钥"
            showLabel="显示 API 密钥"
            hideLabel="隐藏 API 密钥"
            onChange={setValue}
            trailing={
              <button
                type="button"
                aria-label="粘贴 API 密钥"
                className="grid h-8 w-7 place-items-center rounded text-content-muted hover:bg-surface-hover hover:text-content-primary"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setValue("sk-pasted-example-1234567890")}
              >
                <AppIcon icon="copy" size={13} />
              </button>
            }
          />
        </div>
      </div>
    </main>
  );
};

export const States: Story = () => {
  const [value, setValue] = useState("sk-example-key-1234567890");
  return (
    <main className="min-h-[520px] bg-surface-canvas p-6 text-content-primary sm:p-10">
      <div className="mx-auto max-w-[560px] space-y-6">
        <div>
          <h1 className="text-[18px] font-semibold text-content-strong">状态示例</h1>
          <p className="mt-1 text-[12.5px] leading-5 text-content-muted">不同状态下的密钥输入行为。</p>
        </div>

        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-content-secondary">默认状态</label>
          <SecretInput value={value} ariaLabel="默认状态" onChange={setValue} />
        </div>

        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-content-secondary">标准尺寸</label>
          <SecretInput size="md" value={value} ariaLabel="标准尺寸" onChange={setValue} />
        </div>

        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-content-secondary">空值状态</label>
          <SecretInput
            value=""
            placeholder="输入密钥..."
            ariaLabel="空值状态"
            hideRevealWhenEmpty
            onChange={() => {}}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-content-secondary">禁用状态</label>
          <SecretInput value={value} disabled ariaLabel="禁用状态" onChange={() => {}} />
        </div>
      </div>
    </main>
  );
};

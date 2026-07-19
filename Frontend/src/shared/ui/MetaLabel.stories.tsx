import type { Story } from "@ladle/react";
import { FormField, FormHint, FormLabel, Input } from "./Form";
import { MetaLabel } from "./MetaLabel";

export const Sizes: Story = () => (
  <div className="flex min-h-[400px] items-center justify-center p-8">
    <div className="w-full max-w-2xl space-y-8">
      <div>
        <h3 className="mb-4 font-medium text-ink-900">尺寸</h3>
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <MetaLabel size="xs">超小</MetaLabel>
            <span className="text-sm text-ink-500">9.5px</span>
          </div>
          <div className="flex items-center gap-4">
            <MetaLabel size="sm">小号</MetaLabel>
            <span className="text-sm text-ink-500">10px</span>
          </div>
          <div className="flex items-center gap-4">
            <MetaLabel size="md">中号（默认）</MetaLabel>
            <span className="text-sm text-ink-500">10.5px</span>
          </div>
        </div>
      </div>

      <div className="border-t border-ink-200 pt-5">
        <h4 className="mb-3 font-medium text-ink-900">当前特征</h4>
        <ul className="space-y-2 text-sm text-ink-700">
          <li>使用等宽字体，便于元数据对齐</li>
          <li>使用大写和较宽字距表达辅助信息</li>
          <li>默认使用 ink-400 弱化前景色</li>
          <li>适合元数据、标签和补充说明</li>
        </ul>
      </div>
    </div>
  </div>
);

export const UseCases: Story = () => (
  <div className="flex min-h-[500px] items-center justify-center p-8">
    <div className="w-full max-w-2xl space-y-6">
      <div>
        <h3 className="mb-4 font-medium text-ink-900">常见位置</h3>
        <p className="text-sm text-ink-600">MetaLabel 只承担辅助层级，不替代主要标题。</p>
      </div>

      <div className="grid gap-5 border-y border-ink-200 py-5">
        <div>
          <MetaLabel>区块标题</MetaLabel>
          <div className="mt-2 text-base text-ink-900">主要内容标题</div>
          <div className="mt-1 text-sm text-ink-700">这里放置一行补充说明。</div>
        </div>

        <div className="flex items-center justify-between border-t border-ink-200 pt-4">
          <MetaLabel>状态</MetaLabel>
          <span className="text-sm font-medium text-moss-600">可用</span>
        </div>

        <div className="grid grid-cols-3 gap-4 border-t border-ink-200 pt-4">
          <div>
            <MetaLabel size="sm">类别</MetaLabel>
            <div className="mt-1 text-sm text-ink-900">规划</div>
          </div>
          <div>
            <MetaLabel size="sm">状态</MetaLabel>
            <div className="mt-1 text-sm text-ink-900">可用</div>
          </div>
          <div>
            <MetaLabel size="sm">更新时间</MetaLabel>
            <div className="mt-1 text-sm text-ink-900">刚刚</div>
          </div>
        </div>

        <div className="border-t border-ink-200 pt-4">
          <MetaLabel size="sm">记录详情</MetaLabel>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <MetaLabel size="xs">负责人</MetaLabel>
              <div className="mt-0.5 text-sm text-ink-900">设计团队</div>
            </div>
            <div>
              <MetaLabel size="xs">更新时间</MetaLabel>
              <div className="mt-0.5 text-sm text-ink-900">2026-07-19 14:32</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
);

export const InForms: Story = () => (
  <div className="flex min-h-[440px] items-center justify-center p-8">
    <div className="w-full max-w-md">
      <h3 className="mb-6 font-medium text-ink-900">表单辅助标签</h3>
      <div className="space-y-4">
        <FormField>
          <FormLabel>名称</FormLabel>
          <Input placeholder="输入名称" />
        </FormField>
        <FormField>
          <MetaLabel as="label" htmlFor="meta-email">
            联系邮箱
          </MetaLabel>
          <Input id="meta-email" type="email" placeholder="name@example.com" />
          <FormHint>只用于发送必要的通知。</FormHint>
        </FormField>
        <FormField>
          <MetaLabel as="label" htmlFor="meta-note">
            备注
          </MetaLabel>
          <Input id="meta-note" placeholder="补充一条说明" />
        </FormField>
      </div>
    </div>
  </div>
);

export const WithCustomColors: Story = () => (
  <div className="flex min-h-[400px] items-center justify-center p-8">
    <div className="w-full max-w-2xl space-y-6">
      <div>
        <h3 className="mb-4 font-medium text-ink-900">语义颜色</h3>
        <p className="text-sm text-ink-600">只有状态确实需要时才覆盖默认颜色。</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="border border-ink-200 bg-paper-50 p-4">
          <MetaLabel className="text-moss-600">成功</MetaLabel>
          <div className="mt-2 text-sm text-ink-900">操作已完成</div>
        </div>
        <div className="border border-ink-200 bg-paper-50 p-4">
          <MetaLabel className="text-brick-600">错误</MetaLabel>
          <div className="mt-2 text-sm text-ink-900">需要检查输入</div>
        </div>
        <div className="border border-ink-200 bg-paper-50 p-4">
          <MetaLabel className="text-accent-content">提醒</MetaLabel>
          <div className="mt-2 text-sm text-ink-900">请确认当前操作</div>
        </div>
        <div className="border border-ink-200 bg-paper-50 p-4">
          <MetaLabel className="text-ink-600">信息</MetaLabel>
          <div className="mt-2 text-sm text-ink-900">这里是补充信息</div>
        </div>
      </div>
    </div>
  </div>
);

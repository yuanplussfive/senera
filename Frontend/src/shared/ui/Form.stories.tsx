import type { Story } from "@ladle/react";
import { FormField, FormHint, FormLabel, Input } from "./Form";

export const Fields: Story = () => (
  <main className="min-h-[520px] bg-surface-canvas p-6 text-content-primary sm:p-10">
    <form className="mx-auto grid max-w-[560px] gap-6" onSubmit={(event) => event.preventDefault()}>
      <div>
        <h1 className="text-[18px] font-semibold text-content-strong">表单字段</h1>
        <p className="mt-1 text-[12.5px] leading-5 text-content-muted">
          标签、提示和输入框保持同一套间距、颜色与键盘焦点。
        </p>
      </div>

      <FormField>
        <FormLabel required>工作区名称</FormLabel>
        <Input name="workspace-name" placeholder="例如：产品研发" />
        <FormHint>名称会显示在工作区切换菜单中。</FormHint>
      </FormField>

      <FormField>
        <FormLabel>通知邮箱</FormLabel>
        <Input name="email" type="email" placeholder="name@example.com" />
      </FormField>

      <FormField>
        <FormLabel>只读字段</FormLabel>
        <Input value="由系统自动生成" disabled readOnly />
        <FormHint>禁用态仍应保持内容可读。</FormHint>
      </FormField>
    </form>
  </main>
);

export const Validation: Story = () => (
  <main className="min-h-[360px] bg-surface-canvas p-6 text-content-primary sm:p-10">
    <div className="mx-auto max-w-[560px]">
      <h1 className="text-[18px] font-semibold text-content-strong">校验状态</h1>
      <div className="mt-6">
        <FormField>
          <FormLabel required>服务地址</FormLabel>
          <Input defaultValue="不是有效地址" aria-invalid="true" />
          <FormHint className="text-brick-600">请输入以 https:// 开头的有效地址。</FormHint>
        </FormField>
      </div>
    </div>
  </main>
);

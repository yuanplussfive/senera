import type { Story } from "@ladle/react";
import { LogoMark, LogoWordmark, LogoLockup } from "./Logo";

export const Mark: Story = () => (
  <div className="flex items-center justify-center min-h-[400px] p-8">
    <div className="space-y-8">
      <div>
        <h3 className="text-ink-900 font-medium mb-4">Logo Mark Sizes</h3>
        <div className="flex items-center gap-8">
          <div className="text-center">
            <LogoMark size={16} />
            <div className="text-ink-500 text-xs mt-2">16px</div>
          </div>
          <div className="text-center">
            <LogoMark size={20} />
            <div className="text-ink-500 text-xs mt-2">20px (default)</div>
          </div>
          <div className="text-center">
            <LogoMark size={24} />
            <div className="text-ink-500 text-xs mt-2">24px</div>
          </div>
          <div className="text-center">
            <LogoMark size={32} />
            <div className="text-ink-500 text-xs mt-2">32px</div>
          </div>
          <div className="text-center">
            <LogoMark size={48} />
            <div className="text-ink-500 text-xs mt-2">48px</div>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-ink-900 font-medium mb-4">On Different Backgrounds</h3>
        <div className="grid grid-cols-3 gap-4">
          <div className="flex items-center justify-center h-24 rounded-lg bg-paper-50 border border-ink-200">
            <LogoMark size={32} />
          </div>
          <div className="flex items-center justify-center h-24 rounded-lg bg-paper-200">
            <LogoMark size={32} />
          </div>
          <div className="flex items-center justify-center h-24 rounded-lg bg-ink-900">
            <LogoMark size={32} />
          </div>
        </div>
      </div>
    </div>
  </div>
);

export const Wordmark: Story = () => (
  <div className="flex items-center justify-center min-h-[400px] p-8">
    <div className="space-y-8 w-full max-w-2xl">
      <div>
        <h3 className="text-ink-900 font-medium mb-4">Wordmark</h3>
        <div className="flex items-center justify-center rounded-lg border border-ink-200 bg-paper-50 p-8">
          <LogoWordmark />
        </div>
      </div>

      <div>
        <h3 className="text-ink-900 font-medium mb-4">On Different Backgrounds</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex items-center justify-center h-24 rounded-lg bg-paper-100">
            <LogoWordmark />
          </div>
          <div className="flex items-center justify-center h-24 rounded-lg bg-ink-900">
            <LogoWordmark className="text-paper-50" />
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-ink-200 bg-paper-100 p-6">
        <h4 className="text-ink-900 font-medium mb-3">Typography Details</h4>
        <ul className="text-ink-700 text-sm space-y-2">
          <li>• Font: Fraunces (serif), 500 weight</li>
          <li>• Italic style with roman period accent</li>
          <li>• Size: 19px, tracking: tight</li>
          <li>• Period uses brand purple (#7e67c2)</li>
        </ul>
      </div>
    </div>
  </div>
);

export const Lockup: Story = () => (
  <div className="flex items-center justify-center min-h-[400px] p-8">
    <div className="space-y-8 w-full max-w-2xl">
      <div>
        <h3 className="text-ink-900 font-medium mb-4">Full Logo Lockup</h3>
        <div className="flex items-center justify-center rounded-lg border border-ink-200 bg-paper-50 p-8">
          <LogoLockup />
        </div>
      </div>

      <div>
        <h3 className="text-ink-900 font-medium mb-4">Usage Examples</h3>
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-lg border border-ink-200 bg-paper-50 p-4">
            <LogoLockup />
            <div className="flex-1 text-ink-500 text-sm">Navigation header</div>
          </div>

          <div className="flex items-center justify-center rounded-lg bg-ink-900 p-6">
            <LogoLockup className="text-paper-50" />
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-ink-200 bg-paper-100 p-3">
            <LogoMark size={16} />
            <span className="text-ink-900 text-sm font-medium">Compact layout</span>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-ink-200 bg-paper-100 p-6">
        <h4 className="text-ink-900 font-medium mb-3">Usage Guidelines</h4>
        <ul className="text-ink-700 text-sm space-y-2">
          <li>• Use LogoLockup for primary branding (navigation, headers)</li>
          <li>• Use LogoMark alone for space-constrained areas (favicons, mobile)</li>
          <li>• Use LogoWordmark for text-first contexts (footers, titles)</li>
          <li>• Maintain minimum clear space of 8px around logo</li>
          <li>• Don't modify colors or proportions</li>
        </ul>
      </div>
    </div>
  </div>
);

export const BrandColors: Story = () => (
  <div className="flex items-center justify-center min-h-[400px] p-8">
    <div className="w-full max-w-2xl space-y-6">
      <div>
        <h3 className="text-ink-900 font-medium mb-4">Brand Colors</h3>
        <p className="text-ink-600 text-sm mb-6">
          The logo uses a fixed 3-color palette that doesn't change with theme
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-3">
          <div className="h-24 rounded-lg" style={{ backgroundColor: "#7e67c2" }} />
          <div>
            <div className="text-ink-900 font-medium text-sm">Wave Purple</div>
            <div className="text-ink-500 text-xs font-mono">#7e67c2</div>
            <div className="text-ink-600 text-xs mt-1">Primary brand color</div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="h-24 rounded-lg border border-ink-200" style={{ backgroundColor: "#f6cf52" }} />
          <div>
            <div className="text-ink-900 font-medium text-sm">Accent Gold</div>
            <div className="text-ink-500 text-xs font-mono">#f6cf52</div>
            <div className="text-ink-600 text-xs mt-1">Highlight accent</div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="h-24 rounded-lg border border-ink-200" style={{ backgroundColor: "#a3abb2" }} />
          <div>
            <div className="text-ink-900 font-medium text-sm">Node Gray</div>
            <div className="text-ink-500 text-xs font-mono">#a3abb2</div>
            <div className="text-ink-600 text-xs mt-1">Neutral node</div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center rounded-lg border border-ink-200 bg-paper-50 p-12">
        <LogoMark size={80} />
      </div>
    </div>
  </div>
);

import type { Story } from "@ladle/react";

const fontScales = {
  compact: { value: "0.96", label: "Compact (96%)" },
  standard: { value: "1", label: "Standard (100%)" },
  comfortable: { value: "1.04", label: "Comfortable (104%)" },
  large: { value: "1.08", label: "Large (108%)" },
};

export const TypeScale: Story = () => (
  <div className="p-8 space-y-8">
    <div>
      <h2 className="text-ink-900 text-xl font-medium mb-2">Typography Scale</h2>
      <p className="text-ink-600 text-sm">Senera's type system with 4 scaling options</p>
    </div>

    <div className="space-y-6">
      <div>
        <h3 className="text-ink-900 font-medium mb-4">Font Families</h3>
        <div className="space-y-3">
          <div className="rounded-lg border border-ink-200 p-4">
            <div className="text-ink-500 text-xs mb-2">UI Font (Sans)</div>
            <div className="text-ink-900 text-lg font-medium" style={{ fontFamily: 'Geist, ui-sans-serif, system-ui, sans-serif' }}>
              Geist — The quick brown fox jumps over the lazy dog
            </div>
            <div className="text-ink-600 text-sm mt-2 font-mono">font-family: "Geist", ui-sans-serif, system-ui, sans-serif</div>
          </div>

          <div className="rounded-lg border border-ink-200 p-4">
            <div className="text-ink-500 text-xs mb-2">Display Font (Serif)</div>
            <div className="text-ink-900 text-lg font-medium" style={{ fontFamily: 'Fraunces, ui-serif, Georgia, serif' }}>
              Fraunces — The quick brown fox jumps over the lazy dog
            </div>
            <div className="text-ink-600 text-sm mt-2 font-mono">font-family: "Fraunces", ui-serif, Georgia, serif</div>
          </div>

          <div className="rounded-lg border border-ink-200 p-4">
            <div className="text-ink-500 text-xs mb-2">Mono Font</div>
            <div className="text-ink-900 text-lg font-medium font-mono">
              JetBrains Mono — The quick brown fox jumps over the lazy dog
            </div>
            <div className="text-ink-600 text-sm mt-2 font-mono">font-family: "JetBrains Mono", ui-monospace, Menlo, Consolas</div>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-ink-900 font-medium mb-4">Font Scales</h3>
        <div className="space-y-4">
          {Object.entries(fontScales).map(([key, { value, label }]) => (
            <div key={key} className="rounded-lg border border-ink-200 p-4">
              <div className="text-ink-500 text-xs mb-3">{label}</div>
              <div style={{ fontSize: `calc(16px * ${value})` }}>
                <div className="text-ink-900 text-base font-medium mb-2">Base text at {label}</div>
                <div className="text-ink-700 text-sm mb-2">Secondary text scales proportionally with the base</div>
                <div className="text-ink-600 text-xs">Small text maintains readability</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-ink-900 font-medium mb-4">Type Hierarchy</h3>
        <div className="rounded-lg border border-ink-200 p-6 space-y-3">
          <div className="text-ink-900 text-2xl font-medium">Heading 1 (24px)</div>
          <div className="text-ink-900 text-xl font-medium">Heading 2 (20px)</div>
          <div className="text-ink-900 text-lg font-medium">Heading 3 (18px)</div>
          <div className="text-ink-900 text-base font-medium">Heading 4 (16px)</div>
          <div className="text-ink-700 text-base">Body text (16px)</div>
          <div className="text-ink-600 text-sm">Secondary text (14px)</div>
          <div className="text-ink-500 text-xs">Caption text (12px)</div>
        </div>
      </div>

      <div>
        <h3 className="text-ink-900 font-medium mb-4">Line Heights</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-lg border border-ink-200 p-4">
            <div className="text-ink-500 text-xs mb-2">Tight (1.2) — UI Elements</div>
            <div className="text-ink-900 text-sm" style={{ lineHeight: 1.2 }}>
              Tight line height is used for buttons, labels, and compact UI elements where vertical space is limited.
            </div>
          </div>

          <div className="rounded-lg border border-ink-200 p-4">
            <div className="text-ink-500 text-xs mb-2">Normal (1.5) — Default</div>
            <div className="text-ink-900 text-sm" style={{ lineHeight: 1.5 }}>
              Normal line height provides balanced readability for most interface text and short paragraphs.
            </div>
          </div>

          <div className="rounded-lg border border-ink-200 p-4">
            <div className="text-ink-500 text-xs mb-2">Relaxed (1.75) — Long-form</div>
            <div className="text-ink-900 text-sm" style={{ lineHeight: 1.75 }}>
              Relaxed line height improves readability for longer text passages and content-heavy sections.
            </div>
          </div>

          <div className="rounded-lg border border-ink-200 p-4">
            <div className="text-ink-500 text-xs mb-2">Loose (2.0) — Code</div>
            <div className="text-ink-900 text-sm font-mono" style={{ lineHeight: 2.0 }}>
              const example = true;<br />
              // Loose for code
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
);

export const ChatTypography: Story = () => (
  <div className="p-8 space-y-8">
    <div>
      <h2 className="text-ink-900 text-xl font-medium mb-2">Chat Typography</h2>
      <p className="text-ink-600 text-sm">Specialized type settings for chat messages</p>
    </div>

    <div className="space-y-6">
      <div className="rounded-lg border border-ink-200 p-6 space-y-4">
        <div>
          <div className="text-ink-500 text-xs mb-2">User Message</div>
          <div
            className="text-ink-900 rounded-2xl bg-paper-200 px-4 py-3 inline-block"
            style={{
              fontSize: 'var(--theme-chat-user-font-size)',
              lineHeight: 'var(--theme-chat-user-line-height)'
            }}
          >
            This is a user message with optimized readability.<br />
            Font size: 14.5px, Line height: 1.55
          </div>
        </div>

        <div>
          <div className="text-ink-500 text-xs mb-2">Assistant Message</div>
          <div
            className="text-ink-900"
            style={{
              fontSize: 'var(--theme-chat-assistant-font-size)',
              lineHeight: 'var(--theme-chat-assistant-line-height)'
            }}
          >
            This is an assistant message with slightly larger text for easier scanning.<br />
            Font size: 15px, Line height: 1.75
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-ink-200 bg-paper-100 p-6">
        <h4 className="text-ink-900 font-medium mb-3">Typography Guidelines</h4>
        <ul className="text-ink-700 text-sm space-y-2">
          <li>• User messages use compact spacing (1.55) for density</li>
          <li>• Assistant messages use relaxed spacing (1.75) for readability</li>
          <li>• Font scales apply globally via <span className="font-mono text-xs">--theme-font-scale</span></li>
          <li>• All text respects <span className="font-mono text-xs">prefers-reduced-motion</span></li>
        </ul>
      </div>
    </div>
  </div>
);

import type { Story } from "@ladle/react";
import { colorSchemes, createAppearanceTokens, defaultAppearancePreference } from "../../shared/theme/themeModel";

const colorRanges = {
  paper: [50, 100, 200, 300, 400],
  ink: [950, 900, 850, 800, 700, 650, 600, 500, 400, 350, 300, 200, 100, 50],
  accent: [50, 100, 200, 300, 400, 500, 600, 700],
  moss: [50, 100, 400, 500, 600],
  umber: [50, 100, 200, 500, 600],
  brick: [50, 100, 200, 500, 600, 700],
};

const ColorSwatch = ({ color, label, value }: { color: string; label: string; value: string }) => (
  <div className="flex items-center gap-3">
    <div
      className="h-12 w-12 rounded-lg border border-ink-200 shadow-sm"
      style={{ backgroundColor: `rgb(${value})` }}
    />
    <div className="flex-1">
      <div className="text-ink-900 text-sm font-medium">{color}</div>
      <div className="text-ink-500 text-xs font-mono">{label}</div>
      <div className="text-ink-400 text-[10px] font-mono">rgb({value})</div>
    </div>
  </div>
);

export const SeneraLight: Story = () => (
  <div className="p-8 space-y-8">
    <div>
      <h2 className="text-ink-900 text-lg font-medium mb-1">Senera Light</h2>
      <p className="text-ink-600 text-sm">Warm, paper-inspired neutral palette</p>
    </div>

    <div className="grid grid-cols-2 gap-8">
      <div className="space-y-4">
        <h3 className="text-ink-900 font-medium">Paper (Backgrounds)</h3>
        {colorRanges.paper.map((shade) => {
          const cssVar = getComputedStyle(document.documentElement).getPropertyValue(`--color-paper-${shade}`).trim();
          return <ColorSwatch key={shade} color="paper" label={`paper-${shade}`} value={cssVar} />;
        })}
      </div>

      <div className="space-y-4">
        <h3 className="text-ink-900 font-medium">Ink (Foregrounds)</h3>
        {colorRanges.ink.slice(0, 7).map((shade) => {
          const cssVar = getComputedStyle(document.documentElement).getPropertyValue(`--color-ink-${shade}`).trim();
          return <ColorSwatch key={shade} color="ink" label={`ink-${shade}`} value={cssVar} />;
        })}
      </div>
    </div>

    <div className="grid grid-cols-2 gap-8">
      <div className="space-y-4">
        <h3 className="text-ink-900 font-medium">Accent</h3>
        {colorRanges.accent.slice(0, 5).map((shade) => {
          const cssVar = getComputedStyle(document.documentElement).getPropertyValue(`--color-accent-${shade}`).trim();
          return <ColorSwatch key={shade} color="accent" label={`accent-${shade}`} value={cssVar} />;
        })}
      </div>

      <div className="space-y-4">
        <h3 className="text-ink-900 font-medium">Semantic Colors</h3>
        {colorRanges.moss.slice(0, 3).map((shade) => {
          const cssVar = getComputedStyle(document.documentElement).getPropertyValue(`--color-moss-${shade}`).trim();
          return <ColorSwatch key={shade} color="moss" label={`moss-${shade} (success)`} value={cssVar} />;
        })}
        {colorRanges.brick.slice(0, 3).map((shade) => {
          const cssVar = getComputedStyle(document.documentElement).getPropertyValue(`--color-brick-${shade}`).trim();
          return <ColorSwatch key={shade} color="brick" label={`brick-${shade} (error)`} value={cssVar} />;
        })}
      </div>
    </div>
  </div>
);

export const AllSchemes: Story = () => (
  <div className="p-8 space-y-12">
    <div>
      <h2 className="text-ink-900 text-xl font-medium mb-2">Color Schemes</h2>
      <p className="text-ink-600 text-sm">Senera provides 4 color schemes, each with light and dark modes</p>
    </div>

    {colorSchemes.map((scheme) => {
      const tokens = createAppearanceTokens({ ...defaultAppearancePreference, colorScheme: scheme }, "light");

      return (
        <div key={scheme} className="space-y-4">
          <div className="flex items-center gap-3">
            <h3 className="text-ink-900 text-lg font-medium capitalize">{scheme}</h3>
            <span className="text-ink-500 text-sm">
              {scheme === "senera" && "— Warm paper & ink"}
              {scheme === "monochrome" && "— Pure monochrome & high contrast"}
              {scheme === "nordic" && "— Cool slate grays & icy tones"}
              {scheme === "sepia" && "— Warm coffee & retro vibe"}
              {scheme === "lavender" && "— Soft purple-tinted grays"}
              {scheme === "ocean" && "— Deep sea blues"}
            </span>
          </div>

          <div className="grid grid-cols-5 gap-2">
            {colorRanges.paper.map((shade) => {
              const cssVar = tokens.cssVariables[`--color-paper-${shade}`] ?? "";
              return (
                <div key={shade} className="space-y-1">
                  <div
                    className="h-16 rounded-lg border border-ink-200"
                    style={{ backgroundColor: `rgb(${cssVar})` }}
                  />
                  <div className="text-ink-600 text-xs text-center">paper-{shade}</div>
                </div>
              );
            })}
          </div>
        </div>
      );
    })}

    <div className="rounded-lg border border-ink-200 bg-paper-100 p-6 space-y-3">
      <h4 className="text-ink-900 font-medium">Usage Guidelines</h4>
      <ul className="text-ink-700 text-sm space-y-2">
        <li>
          • <span className="font-mono text-xs">paper-*</span> — Backgrounds and surfaces
        </li>
        <li>
          • <span className="font-mono text-xs">ink-*</span> — Text and foreground elements
        </li>
        <li>
          • <span className="font-mono text-xs">accent-*</span> — Selected accent palette
        </li>
        <li>
          • <span className="font-mono text-xs">moss-*</span> — Success states
        </li>
        <li>
          • <span className="font-mono text-xs">brick-*</span> — Error and destructive actions
        </li>
      </ul>
    </div>
  </div>
);

export const ContrastChecker: Story = () => {
  const checkContrast = (fg: string, bg: string): number => {
    const getLuminance = (rgb: string) => {
      const [r, g, b] = rgb.split(" ").map(Number);
      const [rs, gs, bs] = [r, g, b].map((c) => {
        c = c / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
    };

    const l1 = getLuminance(fg);
    const l2 = getLuminance(bg);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  };

  const ink900 = getComputedStyle(document.documentElement).getPropertyValue("--color-ink-900").trim();
  const paper50 = getComputedStyle(document.documentElement).getPropertyValue("--color-paper-50").trim();
  const ratio = checkContrast(ink900, paper50);
  const wcagAA = ratio >= 4.5 ? "✓" : "✗";
  const wcagAAA = ratio >= 7 ? "✓" : "✗";

  return (
    <div className="p-8 space-y-8">
      <div>
        <h2 className="text-ink-900 text-xl font-medium mb-2">Contrast Checker</h2>
        <p className="text-ink-600 text-sm">Verify WCAG 2.1 compliance for text readability</p>
      </div>

      <div className="rounded-lg border border-ink-200 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-ink-900 font-medium">Primary Text (ink-900 on paper-50)</div>
            <div className="text-ink-500 text-sm mt-1">Contrast Ratio: {ratio.toFixed(2)}:1</div>
          </div>
          <div className="flex gap-4">
            <div className="text-center">
              <div className="text-2xl">{wcagAA}</div>
              <div className="text-xs text-ink-500">WCAG AA</div>
            </div>
            <div className="text-center">
              <div className="text-2xl">{wcagAAA}</div>
              <div className="text-xs text-ink-500">WCAG AAA</div>
            </div>
          </div>
        </div>

        <div
          className="h-24 rounded-lg flex items-center justify-center text-ink-900 text-lg font-medium"
          style={{ backgroundColor: `rgb(${paper50})` }}
        >
          Sample Text on Paper-50 Background
        </div>
      </div>

      <div className="rounded-lg border border-ink-200 bg-paper-100 p-6">
        <h4 className="text-ink-900 font-medium mb-3">WCAG Requirements</h4>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-ink-700 font-medium">AA (Minimum)</div>
            <div className="text-ink-600">4.5:1 for normal text</div>
            <div className="text-ink-600">3:1 for large text</div>
          </div>
          <div>
            <div className="text-ink-700 font-medium">AAA (Enhanced)</div>
            <div className="text-ink-600">7:1 for normal text</div>
            <div className="text-ink-600">4.5:1 for large text</div>
          </div>
        </div>
      </div>
    </div>
  );
};

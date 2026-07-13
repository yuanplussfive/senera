import type { Story } from "@ladle/react";
import { ScrollArea } from "./ScrollArea";

export const VerticalScroll: Story = () => (
  <div className="flex items-center justify-center min-h-[400px] p-8">
    <ScrollArea className="h-[300px] w-[350px] rounded-lg border border-ink-200 bg-paper-50 p-4">
      <div className="space-y-4">
        <h3 className="text-ink-900 font-medium">Vertical Scrolling</h3>
        {Array.from({ length: 20 }).map((_, i) => (
          <div key={i} className="rounded-md border border-ink-200 bg-paper-100 p-3">
            <div className="text-ink-900 text-sm font-medium">Item {i + 1}</div>
            <div className="text-ink-600 text-xs mt-1">
              This is item number {i + 1} in the scrollable list
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  </div>
);

export const HorizontalScroll: Story = () => (
  <div className="flex items-center justify-center min-h-[400px] p-8">
    <ScrollArea className="w-full max-w-[600px] whitespace-nowrap rounded-lg border border-ink-200 bg-paper-50 p-4">
      <div className="flex gap-4">
        {Array.from({ length: 15 }).map((_, i) => (
          <div
            key={i}
            className="inline-flex h-[120px] w-[120px] shrink-0 items-center justify-center rounded-lg border border-ink-200 bg-paper-100"
          >
            <div className="text-center">
              <div className="text-ink-900 font-medium">{i + 1}</div>
              <div className="text-ink-500 text-xs">Card</div>
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  </div>
);

export const LongContent: Story = () => (
  <div className="flex items-center justify-center min-h-[500px] p-8">
    <div className="w-[500px] space-y-4">
      <h3 className="text-ink-900 font-medium">Long Content</h3>
      <ScrollArea className="h-[400px] rounded-lg border border-ink-200 bg-paper-50 p-4">
        <div className="space-y-4">
          {Array.from({ length: 12 }, (_, index) => (
            <div key={index} className="rounded-md border border-ink-200 bg-paper-100 p-3">
              <div className="text-ink-900 text-sm font-medium">Section {index + 1}</div>
              <div className="mt-1 text-ink-600 text-sm">
                Example content remains readable while the viewport scrolls.
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  </div>
);

export const WithTags: Story = () => (
  <div className="flex items-center justify-center min-h-[400px] p-8">
    <ScrollArea className="h-[200px] w-[300px] rounded-lg border border-ink-200 bg-paper-50 p-4">
      <div className="flex flex-wrap gap-2">
        {[
          "React", "TypeScript", "Tailwind CSS", "Vite", "Radix UI",
          "Framer Motion", "Ladle", "Design System", "Component Library",
          "UI/UX", "Frontend", "Web Development", "Modern Stack",
          "Storybook Alternative", "Documentation", "Developer Tools"
        ].map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center rounded-md bg-paper-200 px-2.5 py-0.5 text-ink-800 text-xs font-medium border border-ink-200"
          >
            {tag}
          </span>
        ))}
      </div>
    </ScrollArea>
  </div>
);

import type { Story } from "@ladle/react";
import { MetaLabel } from "./MetaLabel";

export const Sizes: Story = () => (
  <div className="flex items-center justify-center min-h-[400px] p-8">
    <div className="space-y-8 w-full max-w-2xl">
      <div>
        <h3 className="text-ink-900 font-medium mb-4">Size Variants</h3>
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <MetaLabel size="xs">Extra Small</MetaLabel>
            <span className="text-ink-500 text-sm">— 9.5px</span>
          </div>
          <div className="flex items-center gap-4">
            <MetaLabel size="sm">Small</MetaLabel>
            <span className="text-ink-500 text-sm">— 10px</span>
          </div>
          <div className="flex items-center gap-4">
            <MetaLabel size="md">Medium (Default)</MetaLabel>
            <span className="text-ink-500 text-sm">— 10.5px</span>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-ink-200 bg-paper-100 p-6">
        <h4 className="text-ink-900 font-medium mb-3">Characteristics</h4>
        <ul className="text-ink-700 text-sm space-y-2">
          <li>• Monospace font for tabular alignment</li>
          <li>• Uppercase with wide tracking</li>
          <li>• Color: ink-400 (muted foreground)</li>
          <li>• Used for metadata, labels, and auxiliary info</li>
        </ul>
      </div>
    </div>
  </div>
);

export const UseCases: Story = () => (
  <div className="flex items-center justify-center min-h-[500px] p-8">
    <div className="space-y-6 w-full max-w-2xl">
      <div>
        <h3 className="text-ink-900 font-medium mb-4">Common Use Cases</h3>
      </div>

      <div className="space-y-4">
        <div className="rounded-lg border border-ink-200 bg-paper-50 p-4">
          <MetaLabel>Section Header</MetaLabel>
          <div className="text-ink-900 text-base mt-2">Main Content Title</div>
          <div className="text-ink-700 text-sm mt-1">
            Supporting description text goes here
          </div>
        </div>

        <div className="rounded-lg border border-ink-200 bg-paper-50 p-4">
          <div className="flex items-center justify-between mb-2">
            <MetaLabel>Status</MetaLabel>
            <span className="text-moss-600 text-sm font-medium">Active</span>
          </div>
          <div className="flex items-center justify-between">
            <MetaLabel>Created</MetaLabel>
            <span className="text-ink-700 text-sm">2024-07-12</span>
          </div>
        </div>

        <div className="rounded-lg border border-ink-200 bg-paper-50 p-4">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <MetaLabel size="sm">Category</MetaLabel>
              <div className="text-ink-900 text-sm mt-1">Planning</div>
            </div>
            <div>
              <MetaLabel size="sm">Status</MetaLabel>
              <div className="text-ink-900 text-sm mt-1">Active</div>
            </div>
            <div>
              <MetaLabel size="sm">Updated</MetaLabel>
              <div className="text-ink-900 text-sm mt-1">Today</div>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-ink-200 bg-paper-50 overflow-hidden">
          <div className="bg-paper-200 px-4 py-2 border-b border-ink-200">
            <MetaLabel size="sm">Record Details</MetaLabel>
          </div>
          <div className="p-4 space-y-3">
            <div>
              <MetaLabel size="xs">Owner</MetaLabel>
              <div className="text-ink-900 text-sm mt-0.5">Design team</div>
            </div>
            <div>
              <MetaLabel size="xs">Updated</MetaLabel>
              <div className="text-ink-900 text-sm mt-0.5">2024-07-12 14:32:15</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
);

export const InForms: Story = () => (
  <div className="flex items-center justify-center min-h-[400px] p-8">
    <div className="w-full max-w-md">
      <h3 className="text-ink-900 font-medium mb-6">Form Field Labels</h3>
      <div className="space-y-4">
        <div>
          <MetaLabel as="label" htmlFor="name">Name</MetaLabel>
          <input
            id="name"
            type="text"
            placeholder="Enter your name"
            className="mt-1.5 w-full h-9 px-3 rounded-lg border border-ink-200 bg-paper-50 text-ink-900 text-sm focus:outline-none focus:ring-2 focus:ring-terra-200/70"
          />
        </div>

        <div>
          <MetaLabel as="label" htmlFor="email">Email Address</MetaLabel>
          <input
            id="email"
            type="email"
            placeholder="you@example.com"
            className="mt-1.5 w-full h-9 px-3 rounded-lg border border-ink-200 bg-paper-50 text-ink-900 text-sm focus:outline-none focus:ring-2 focus:ring-terra-200/70"
          />
        </div>

        <div>
          <MetaLabel as="label" htmlFor="notes">Notes</MetaLabel>
          <textarea
            id="notes"
            rows={4}
            placeholder="Add a note..."
            className="mt-1.5 w-full px-3 py-2 rounded-lg border border-ink-200 bg-paper-50 text-ink-900 text-sm focus:outline-none focus:ring-2 focus:ring-terra-200/70 resize-none"
          />
        </div>
      </div>
    </div>
  </div>
);

export const WithCustomColors: Story = () => (
  <div className="flex items-center justify-center min-h-[400px] p-8">
    <div className="space-y-6 w-full max-w-2xl">
      <div>
        <h3 className="text-ink-900 font-medium mb-4">Custom Color Variants</h3>
        <p className="text-ink-600 text-sm">Override default color with className</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-ink-200 bg-paper-50 p-4">
          <MetaLabel className="text-moss-600">Success</MetaLabel>
          <div className="text-ink-900 text-sm mt-2">Operation completed successfully</div>
        </div>

        <div className="rounded-lg border border-ink-200 bg-paper-50 p-4">
          <MetaLabel className="text-brick-600">Error</MetaLabel>
          <div className="text-ink-900 text-sm mt-2">Something went wrong</div>
        </div>

        <div className="rounded-lg border border-ink-200 bg-paper-50 p-4">
          <MetaLabel className="text-terra-600">Warning</MetaLabel>
          <div className="text-ink-900 text-sm mt-2">Please review this action</div>
        </div>

        <div className="rounded-lg border border-ink-200 bg-paper-50 p-4">
          <MetaLabel className="text-ink-600">Info</MetaLabel>
          <div className="text-ink-900 text-sm mt-2">Additional information here</div>
        </div>
      </div>
    </div>
  </div>
);

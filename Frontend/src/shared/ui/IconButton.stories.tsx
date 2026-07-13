import type { Story } from "@ladle/react";
import { X, Settings, Search, Heart, Star, Trash2 } from "lucide-react";
import { IconButton } from "./IconButton";

export const Sizes: Story = () => (
  <div className="flex flex-col gap-6 p-8">
    <div className="space-y-3">
      <h3 className="text-ink-900 font-medium">Size Variants</h3>
      <div className="flex items-center gap-3">
        <IconButton label="Small icon" size="sm">
          <Settings className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton label="Medium icon" size="md">
          <Settings className="h-4 w-4" />
        </IconButton>
        <IconButton label="Large icon" size="lg">
          <Settings className="h-5 w-5" />
        </IconButton>
      </div>
    </div>
  </div>
);

export const Tones: Story = () => (
  <div className="flex flex-col gap-6 p-8">
    <div className="space-y-3">
      <h3 className="text-ink-900 font-medium">Tone Variants</h3>
      <div className="flex items-center gap-3">
        <IconButton label="Neutral" tone="neutral">
          <Settings className="h-4 w-4" />
        </IconButton>
        <IconButton label="Muted" tone="muted">
          <Settings className="h-4 w-4" />
        </IconButton>
        <IconButton label="Primary" tone="primary">
          <Settings className="h-4 w-4" />
        </IconButton>
        <IconButton label="Danger" tone="danger">
          <Trash2 className="h-4 w-4" />
        </IconButton>
      </div>
    </div>
  </div>
);

export const WithTooltips: Story = () => (
  <div className="flex flex-col gap-6 p-8">
    <div className="space-y-3">
      <h3 className="text-ink-900 font-medium">With Tooltips</h3>
      <div className="flex items-center gap-3">
        <IconButton label="Close" tooltip="Close dialog">
          <X className="h-4 w-4" />
        </IconButton>
        <IconButton label="Settings" tooltip="Open settings" tooltipShortcut="⌘,">
          <Settings className="h-4 w-4" />
        </IconButton>
        <IconButton label="Search" tooltip="Search" tooltipShortcut="⌘K">
          <Search className="h-4 w-4" />
        </IconButton>
      </div>
    </div>
  </div>
);

export const AllVariants: Story = () => (
  <div className="flex flex-col gap-6 p-8">
    <div className="space-y-3">
      <h3 className="text-ink-900 font-medium">Small</h3>
      <div className="flex items-center gap-2">
        <IconButton label="Close" size="sm" tone="neutral">
          <X className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton label="Settings" size="sm" tone="muted">
          <Settings className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton label="Heart" size="sm" tone="primary">
          <Heart className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton label="Delete" size="sm" tone="danger">
          <Trash2 className="h-3.5 w-3.5" />
        </IconButton>
      </div>
    </div>

    <div className="space-y-3">
      <h3 className="text-ink-900 font-medium">Medium (Default)</h3>
      <div className="flex items-center gap-2">
        <IconButton label="Close" tone="neutral">
          <X className="h-4 w-4" />
        </IconButton>
        <IconButton label="Settings" tone="muted">
          <Settings className="h-4 w-4" />
        </IconButton>
        <IconButton label="Star" tone="primary">
          <Star className="h-4 w-4" />
        </IconButton>
        <IconButton label="Delete" tone="danger">
          <Trash2 className="h-4 w-4" />
        </IconButton>
      </div>
    </div>

    <div className="space-y-3">
      <h3 className="text-ink-900 font-medium">Large</h3>
      <div className="flex items-center gap-2">
        <IconButton label="Close" size="lg" tone="neutral">
          <X className="h-5 w-5" />
        </IconButton>
        <IconButton label="Settings" size="lg" tone="muted">
          <Settings className="h-5 w-5" />
        </IconButton>
        <IconButton label="Search" size="lg" tone="primary">
          <Search className="h-5 w-5" />
        </IconButton>
        <IconButton label="Delete" size="lg" tone="danger">
          <Trash2 className="h-5 w-5" />
        </IconButton>
      </div>
    </div>

    <div className="space-y-3">
      <h3 className="text-ink-900 font-medium">Disabled State</h3>
      <div className="flex items-center gap-2">
        <IconButton label="Close" disabled>
          <X className="h-4 w-4" />
        </IconButton>
        <IconButton label="Settings" tone="muted" disabled>
          <Settings className="h-4 w-4" />
        </IconButton>
        <IconButton label="Star" tone="primary" disabled>
          <Star className="h-4 w-4" />
        </IconButton>
        <IconButton label="Delete" tone="danger" disabled>
          <Trash2 className="h-4 w-4" />
        </IconButton>
      </div>
    </div>
  </div>
);

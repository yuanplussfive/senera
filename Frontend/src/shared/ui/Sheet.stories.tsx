import type { Story } from "@ladle/react";
import { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "./Button";
import { Sheet, SheetTrigger, SheetContent, SheetClose } from "./Sheet";

export const LeftSheet: Story = () => {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex items-center justify-center min-h-[400px] p-8">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button>
            <Menu className="h-4 w-4" />
            Open Left Sheet
          </Button>
        </SheetTrigger>
        <SheetContent side="left" title="Left Sheet" description="This is a sheet sliding from the left side.">
          <div className="mt-6 space-y-4">
            <p className="text-ink-700 text-sm">Sheets are side panels that slide in from the edge of the screen.</p>
            <p className="text-ink-700 text-sm">They're useful for navigation menus, filters, or detail views.</p>
          </div>
          <div className="mt-6">
            <SheetClose asChild>
              <Button className="w-full">Close</Button>
            </SheetClose>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export const RightSheet: Story = () => {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex items-center justify-center min-h-[400px] p-8">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="outline">
            <Menu className="h-4 w-4" />
            Open Right Sheet
          </Button>
        </SheetTrigger>
        <SheetContent side="right" title="Right Sheet" description="This is a sheet sliding from the right side.">
          <div className="mt-6 space-y-4">
            <div className="rounded-lg border border-ink-200 p-4">
              <h4 className="text-ink-900 font-medium mb-2">Example Content</h4>
              <p className="text-ink-600 text-sm">
                You can put any content inside a sheet - forms, lists, settings, etc.
              </p>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export const WithForm: Story = () => {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex items-center justify-center min-h-[400px] p-8">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button>Open Settings</Button>
        </SheetTrigger>
        <SheetContent side="right" title="Settings" description="Configure your preferences here.">
          <div className="mt-6 space-y-4">
            <div className="space-y-2">
              <label htmlFor="sheet-name" className="text-sm font-medium text-ink-900">
                Name
              </label>
              <input
                id="sheet-name"
                name="name"
                type="text"
                autoComplete="name"
                placeholder="Enter your name"
                className="w-full h-9 px-3 rounded-lg border border-ink-200 bg-paper-50 text-ink-900 text-sm focus:outline-none focus:ring-2 focus:ring-accent-focus"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="sheet-email" className="text-sm font-medium text-ink-900">
                Email
              </label>
              <input
                id="sheet-email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="your@email.com"
                className="w-full h-9 px-3 rounded-lg border border-ink-200 bg-paper-50 text-ink-900 text-sm focus:outline-none focus:ring-2 focus:ring-accent-focus"
              />
            </div>
            <div className="flex gap-2 pt-4">
              <SheetClose asChild>
                <Button variant="ghost" className="flex-1">
                  Cancel
                </Button>
              </SheetClose>
              <Button className="flex-1">Save</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

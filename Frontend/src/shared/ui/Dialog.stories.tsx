import type { Story } from "@ladle/react";
import { useState } from "react";
import { Dialog, DialogTrigger, DialogContent, DialogActions, DialogActionButton } from "./Dialog";
import { Button } from "./Button";

export const BasicDialog: Story = () => {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex items-center justify-center min-h-[400px] p-8">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button>Open Dialog</Button>
        </DialogTrigger>
        <DialogContent
          motionPreset="modal"
          title="Dialog Title"
          description="This is a dialog description. It provides context about what this dialog does."
        >
          <div className="space-y-4">
            <p className="text-ink-700 text-sm">This is the dialog content. You can put any content here.</p>
            <DialogActions>
              <DialogActionButton close variant="secondary">
                Cancel
              </DialogActionButton>
              <DialogActionButton close variant="primary">
                Confirm
              </DialogActionButton>
            </DialogActions>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export const DestructiveDialog: Story = () => {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex items-center justify-center min-h-[400px] p-8">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="destructive">Delete Item</Button>
        </DialogTrigger>
        <DialogContent
          motionPreset="modal"
          title="Are you sure?"
          description="This action cannot be undone. This will permanently delete the item."
        >
          <div className="space-y-4">
            <p className="text-ink-700 text-sm">
              Please confirm that you want to proceed with this destructive action.
            </p>
            <DialogActions>
              <DialogActionButton close variant="secondary">
                Cancel
              </DialogActionButton>
              <DialogActionButton close variant="danger">
                Delete
              </DialogActionButton>
            </DialogActions>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export const WithoutDescription: Story = () => {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex items-center justify-center min-h-[400px] p-8">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button>Open Simple Dialog</Button>
        </DialogTrigger>
        <DialogContent motionPreset="modal" title="Simple Dialog">
          <div className="space-y-4">
            <p className="text-ink-700 text-sm">This dialog doesn't have a description, only a title.</p>
            <DialogActions>
              <DialogActionButton close variant="primary">
                Close
              </DialogActionButton>
            </DialogActions>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

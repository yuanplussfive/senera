import type { Story } from "@ladle/react";
import { Button, type ButtonProps } from "./Button";

export const Default: Story<ButtonProps> = () => (
  <div className="flex flex-col gap-4 p-8">
    <div className="flex gap-3">
      <Button>Default Button</Button>
      <Button variant="ghost">Ghost Button</Button>
      <Button variant="outline">Outline Button</Button>
      <Button variant="destructive">Destructive Button</Button>
    </div>
  </div>
);

export const Sizes: Story<ButtonProps> = () => (
  <div className="flex flex-col gap-4 p-8">
    <div className="flex items-center gap-3">
      <Button size="sm">Small</Button>
      <Button size="default">Default</Button>
      <Button size="icon">★</Button>
    </div>
  </div>
);

export const States: Story<ButtonProps> = () => (
  <div className="flex flex-col gap-4 p-8">
    <div className="flex gap-3">
      <Button>Normal</Button>
      <Button disabled>Disabled</Button>
    </div>
  </div>
);

export const AllVariants: Story<ButtonProps> = () => (
  <div className="flex flex-col gap-6 p-8">
    <div className="space-y-3">
      <h3 className="text-ink-900 font-medium">Default Variant</h3>
      <div className="flex gap-3">
        <Button size="sm">Small</Button>
        <Button>Default</Button>
        <Button size="icon">★</Button>
      </div>
    </div>

    <div className="space-y-3">
      <h3 className="text-ink-900 font-medium">Ghost Variant</h3>
      <div className="flex gap-3">
        <Button variant="ghost" size="sm">Small</Button>
        <Button variant="ghost">Default</Button>
        <Button variant="ghost" size="icon">★</Button>
      </div>
    </div>

    <div className="space-y-3">
      <h3 className="text-ink-900 font-medium">Outline Variant</h3>
      <div className="flex gap-3">
        <Button variant="outline" size="sm">Small</Button>
        <Button variant="outline">Default</Button>
        <Button variant="outline" size="icon">★</Button>
      </div>
    </div>

    <div className="space-y-3">
      <h3 className="text-ink-900 font-medium">Destructive Variant</h3>
      <div className="flex gap-3">
        <Button variant="destructive" size="sm">Small</Button>
        <Button variant="destructive">Default</Button>
        <Button variant="destructive" size="icon">★</Button>
      </div>
    </div>

    <div className="space-y-3">
      <h3 className="text-ink-900 font-medium">Disabled State</h3>
      <div className="flex gap-3">
        <Button disabled>Default</Button>
        <Button variant="ghost" disabled>Ghost</Button>
        <Button variant="outline" disabled>Outline</Button>
        <Button variant="destructive" disabled>Destructive</Button>
      </div>
    </div>
  </div>
);

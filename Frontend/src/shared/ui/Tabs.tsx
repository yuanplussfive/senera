import * as TabsPrimitive from "@radix-ui/react-tabs";
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useState,
  type ComponentPropsWithoutRef,
  type ElementRef,
  type PointerEvent as ReactPointerEvent,
  type Ref,
} from "react";
import { cn } from "../../lib/util";
import {
  FluidSegmentedLayers,
  useFluidSegmentedSurface,
  type FluidSegmentedSurface,
  type FluidSegmentedVariant,
} from "./FluidSegmentedSurface";

interface FluidTabsContextValue {
  readonly value: string | undefined;
}

interface FluidTabsListContextValue {
  readonly surface: FluidSegmentedSurface;
}

const FluidTabsContext = createContext<FluidTabsContextValue | null>(null);
const FluidTabsListContext = createContext<FluidTabsListContextValue | null>(null);

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === "function") {
    ref(value);
  } else if (ref) {
    ref.current = value;
  }
}

export const Tabs = forwardRef<
  ElementRef<typeof TabsPrimitive.Root>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Root>
>(({ value, defaultValue, onValueChange, children, ...props }, ref) => {
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue);
  const selectedValue = value ?? uncontrolledValue;
  const handleValueChange = useCallback(
    (nextValue: string) => {
      if (value === undefined) setUncontrolledValue(nextValue);
      onValueChange?.(nextValue);
    },
    [onValueChange, value],
  );

  return (
    <FluidTabsContext.Provider value={{ value: selectedValue }}>
      <TabsPrimitive.Root
        ref={ref}
        value={value}
        defaultValue={defaultValue}
        onValueChange={handleValueChange}
        activationMode="automatic"
        {...props}
      >
        {children}
      </TabsPrimitive.Root>
    </FluidTabsContext.Provider>
  );
});
Tabs.displayName = TabsPrimitive.Root.displayName;

export interface TabsListProps extends ComponentPropsWithoutRef<typeof TabsPrimitive.List> {
  /** Underline keeps dense workbench chrome compact; other lists use the raised shared segment. */
  variant?: FluidSegmentedVariant;
}

export const TabsList = forwardRef<ElementRef<typeof TabsPrimitive.List>, TabsListProps>(
  ({ className, children, variant = "segmented", onPointerLeave, ...props }, ref) => {
    const tabs = useContext(FluidTabsContext);
    const surface = useFluidSegmentedSurface(tabs?.value);
    const { containerRef } = surface;
    const listRef = useCallback(
      (node: ElementRef<typeof TabsPrimitive.List> | null) => {
        containerRef(node);
        assignRef(ref, node);
      },
      [containerRef, ref],
    );

    return (
      <FluidTabsListContext.Provider value={{ surface }}>
        <TabsPrimitive.List
          ref={listRef}
          className={cn(
            "relative inline-flex h-9 min-w-0 items-center gap-0.5 rounded-lg border border-line-subtle bg-surface-subtle p-1 text-content-muted",
            variant === "underline" && "gap-4 rounded-none border-0 bg-transparent p-0",
            className,
          )}
          onPointerLeave={(event) => {
            surface.onItemPointerLeave(event);
            onPointerLeave?.(event);
          }}
          {...props}
        >
          <FluidSegmentedLayers surface={surface} variant={variant} />
          {children}
        </TabsPrimitive.List>
      </FluidTabsListContext.Provider>
    );
  },
);
TabsList.displayName = TabsPrimitive.List.displayName;

export const TabsTrigger = forwardRef<
  ElementRef<typeof TabsPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, value, onPointerEnter, onPointerLeave, ...props }, ref) => {
  const list = useContext(FluidTabsListContext);
  const register = list?.surface.registerItem;
  const triggerRef = useCallback(
    (node: ElementRef<typeof TabsPrimitive.Trigger> | null) => {
      register?.(value, node);
      assignRef(ref, node);
    },
    [ref, register, value],
  );

  return (
    <TabsPrimitive.Trigger
      ref={triggerRef}
      value={value}
      className={cn(
        "relative z-10 inline-flex h-7 min-w-0 flex-1 items-center justify-center overflow-hidden text-ellipsis whitespace-nowrap rounded-md px-2.5 text-[12px] font-medium outline-none",
        "transition-[color,font-weight] duration-150 ease-out",
        "text-content-secondary hover:text-content-primary",
        "focus-visible:ring-2 focus-visible:ring-accent-focus",
        "disabled:pointer-events-none disabled:opacity-50",
        "data-[state=active]:text-content-primary",
        className,
      )}
      onPointerEnter={(event: ReactPointerEvent<HTMLButtonElement>) => {
        list?.surface.onItemPointerEnter(value, event);
        onPointerEnter?.(event);
      }}
      onPointerLeave={(event: ReactPointerEvent<HTMLButtonElement>) => {
        list?.surface.onItemPointerLeave(event);
        onPointerLeave?.(event);
      }}
      {...props}
    />
  );
});
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

export const TabsContent = forwardRef<
  ElementRef<typeof TabsPrimitive.Content>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-focus",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

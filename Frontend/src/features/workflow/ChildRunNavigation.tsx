import { createContext, useContext } from "react";

export interface ChildRunNavigation {
  open: (childRunId: string) => void;
}

/** The app owns dock navigation; execution rows only identify the selected child. */
export const ChildRunNavigationContext = createContext<ChildRunNavigation | null>(null);

export function useChildRunNavigation(): ChildRunNavigation | null {
  return useContext(ChildRunNavigationContext);
}

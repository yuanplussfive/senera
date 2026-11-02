import type * as React from "react";

// React 19 no longer defines the legacy global JSX namespace. Keep the existing
// component signatures source-compatible while files migrate to React.JSX.Element.
declare global {
  namespace JSX {
    type Element = React.JSX.Element;
  }
}

export {};

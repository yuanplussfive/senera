import { forwardRef } from "react";
import { Virtuoso, type VirtuosoHandle, type VirtuosoProps } from "react-virtuoso";
import type { ProjectedMessageListItem } from "./assistantTurnProjection";

export const MessageListVirtualizer = forwardRef<VirtuosoHandle, VirtuosoProps<ProjectedMessageListItem, unknown>>(
  function MessageListVirtualizer(props, ref) {
    return <Virtuoso {...props} ref={ref} />;
  },
);

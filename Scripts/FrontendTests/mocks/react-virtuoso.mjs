import React from "react";

export const Virtuoso = React.forwardRef(function TestVirtuoso(props, ref) {
  React.useImperativeHandle(ref, () => ({
    scrollTo: () => undefined,
    scrollToIndex: () => undefined,
  }));

  const setScrollerRef = React.useCallback((node) => {
    props.scrollerRef?.(node);
    if (node) props.scrollerRef?.(node);
  }, [props.scrollerRef]);

  const Header = props.components?.Header;
  const Footer = props.components?.Footer;
  const data = props.data ?? [];
  return React.createElement(
    "div",
    { "data-testid": "virtuoso", ref: setScrollerRef },
    Header ? React.createElement(Header) : null,
    ...data.map((item, index) =>
      React.createElement(
        "div",
        { key: props.computeItemKey?.(index, item) ?? index },
        props.itemContent?.(index, item),
      ),
    ),
    Footer ? React.createElement(Footer) : null,
  );
});

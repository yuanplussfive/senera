import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { Dialog, DialogContent } from "../../../Frontend/src/shared/ui/Dialog.tsx";

afterEach(() => {
  cleanup();
});

test("in-app dialog headers do not move their frame on pointer input", () => {
  render(
    React.createElement(
      Dialog,
      { open: true },
      React.createElement(DialogContent, { title: "固定弹窗" }, React.createElement("p", null, "弹窗内容")),
    ),
  );

  const dialog = screen.getByRole("dialog", { name: "固定弹窗" });
  const title = screen.getByText("固定弹窗");

  fireEvent.pointerDown(title, { button: 0, clientX: 120, clientY: 100, pointerId: 1 });
  fireEvent.pointerMove(title, { clientX: 360, clientY: 280, pointerId: 1 });
  fireEvent.pointerUp(title, { pointerId: 1 });

  expect(dialog.style.translate).toBe("");
  expect(title.parentElement).not.toHaveClass("lg:cursor-move");
});

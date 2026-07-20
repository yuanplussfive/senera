import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { Dialog, DialogActionButton, DialogContent } from "../../../Frontend/src/shared/ui/Dialog.tsx";
import { Sheet, SheetContent } from "../../../Frontend/src/shared/ui/Sheet.tsx";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "../../../Frontend/src/shared/ui/DropdownMenu.tsx";

afterEach(() => {
  cleanup();
});

test("in-app dialog headers do not move their frame on pointer input", () => {
  render(
    React.createElement(
      Dialog,
      { open: true },
      React.createElement(
        DialogContent,
        { title: "固定弹窗", description: "弹窗说明" },
        React.createElement("p", null, "弹窗内容"),
        React.createElement(DialogActionButton, null, "确认"),
      ),
    ),
  );

  const dialog = screen.getByRole("dialog", { name: "固定弹窗" });
  const title = screen.getByText("固定弹窗");

  fireEvent.pointerDown(title, { button: 0, clientX: 120, clientY: 100, pointerId: 1 });
  fireEvent.pointerMove(title, { clientX: 360, clientY: 280, pointerId: 1 });
  fireEvent.pointerUp(title, { pointerId: 1 });

  expect(dialog.style.translate).toBe("");
  expect(document.querySelector(".fixed.inset-0")).toHaveClass("bg-[var(--theme-dialog-backdrop)]");
  expect(document.querySelector("[data-dialog-panel='true']")).not.toHaveClass(
    "[box-shadow:var(--theme-overlay-shadow)]",
  );
  expect(screen.getByRole("button", { name: "确认" })).toHaveClass("cursor-pointer");
  expect(title.parentElement).not.toHaveClass("lg:cursor-move");
});

test("sheets use the shared dimming layer and menu items expose pointer affordance", () => {
  const sheetRender = render(
    React.createElement(
      Sheet,
      { open: true },
      React.createElement(SheetContent, { title: "节点详情" }, React.createElement("p", null, "详情内容")),
    ),
  );

  expect(document.querySelector(".fixed.inset-0")).toHaveClass("bg-[var(--theme-sheet-backdrop)]");
  expect(screen.getByRole("dialog", { name: "节点详情" })).not.toHaveClass("[box-shadow:var(--theme-overlay-shadow)]");
  sheetRender.unmount();

  render(
    React.createElement(
      DropdownMenu,
      { open: true },
      React.createElement(DropdownMenuContent, null, React.createElement(DropdownMenuItem, null, "菜单选项")),
    ),
  );
  expect(screen.getByRole("menuitem", { name: "菜单选项" })).toHaveClass("cursor-pointer");
});

test("dialogs can hide their default header and close control while preserving an accessible name", () => {
  render(
    React.createElement(
      Dialog,
      { open: true },
      React.createElement(
        DialogContent,
        { title: "设置工作台", description: "设置说明", showHeader: false, showClose: false },
        React.createElement("button", { type: "button" }, "宿主关闭"),
      ),
    ),
  );

  expect(screen.getByRole("dialog", { name: "设置工作台" })).toBeInTheDocument();
  expect(screen.getByText("设置工作台")).toHaveClass("sr-only");
  expect(screen.queryByRole("button", { name: "关闭" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "宿主关闭" })).toBeInTheDocument();
});

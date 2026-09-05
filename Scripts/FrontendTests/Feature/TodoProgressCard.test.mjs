import React from "react";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";

const { TodoProgressCard } = await import("../../../Frontend/src/features/chat/TodoProgressCard.tsx");

afterEach(() => {
  cleanup();
});

function runWithTodos(todos, status = "running") {
  return {
    status,
    todos: {
      items: todos,
      counts: todos.reduce(
        (acc, item) => {
          acc[item.status] += 1;
          return acc;
        },
        { total: todos.length, pending: 0, inProgress: 0, completed: 0, cancelled: 0 },
      ),
    },
  };
}

function item(id, content, status) {
  return {
    id,
    content,
    status,
    order: 0,
    createdAt: "2026-08-26T10:00:00.000Z",
    updatedAt: "2026-08-26T10:00:00.000Z",
  };
}

const emptyCounts = { total: 0, pending: 0, inProgress: 0, completed: 0, cancelled: 0 };

test("renders the task list card with progress states above an assistant answer", () => {
  renderWithFrontendProviders(
    React.createElement(TodoProgressCard, {
      run: runWithTodos([
        item("1", "完成研究", "in_progress"),
        item("2", "发布构建", "pending"),
        item("3", "通知用户", "completed"),
      ]),
    }),
  );

  expect(screen.getByTestId("todo-progress-card")).toBeInTheDocument();
  expect(screen.getByText("完成研究")).toBeInTheDocument();
  expect(screen.getByText("发布构建")).toBeInTheDocument();
  expect(screen.getByText("通知用户")).toBeInTheDocument();
  expect(document.querySelector("[data-todo-item='in_progress']")).toBeInTheDocument();
  expect(document.querySelector("[data-todo-item='completed']")).toBeInTheDocument();
  expect(screen.getByText(/待完成 2 项/)).toBeInTheDocument();
});

test("hides the card when no items exist", () => {
  renderWithFrontendProviders(
    React.createElement(TodoProgressCard, {
      run: { status: "running", todos: { items: [], counts: emptyCounts } },
    }),
  );
  expect(screen.queryByTestId("todo-progress-card")).not.toBeInTheDocument();
});

test("hides the card for cancelled or failed runs", () => {
  const { rerender } = renderWithFrontendProviders(
    React.createElement(TodoProgressCard, {
      run: runWithTodos([item("1", "剩余任务", "pending")], "cancelled"),
    }),
  );
  expect(screen.queryByTestId("todo-progress-card")).not.toBeInTheDocument();

  rerender(
    React.createElement(TodoProgressCard, {
      run: runWithTodos([item("2", "失败任务", "pending")], "failed"),
    }),
  );
  expect(screen.queryByTestId("todo-progress-card")).not.toBeInTheDocument();
});

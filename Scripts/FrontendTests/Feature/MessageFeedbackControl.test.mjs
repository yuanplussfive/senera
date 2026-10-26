import React from "react";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";
import { installMemoryLocalStorage, resetFrontendStore } from "../frontendStoreTestHarness.mjs";
import { frontendMessage } from "../../../Frontend/src/i18n/frontendMessageCatalog.ts";
import { frontendFeatureMessage } from "../../../Frontend/src/i18n/frontendFeatureMessageCatalog.ts";

const { MessageFeedbackControl } = await import("../../../Frontend/src/features/chat/MessageFeedbackControl.tsx");
const { useStore } = await import("../../../Frontend/src/store/sessionStore.ts");

const SessionId = "session_feedback";
const RequestId = "request_feedback";

beforeEach(() => {
  installMemoryLocalStorage();
  resetFrontendStore();
  useStore.setState({
    sessions: {
      [SessionId]: { sessionId: SessionId, title: "反馈", status: "ready", messages: [], runs: [] },
    },
  });
});

afterEach(() => {
  cleanup();
});

function renderControl(onRecord = vi.fn()) {
  renderWithFrontendProviders(
    React.createElement(MessageFeedbackControl, { sessionId: SessionId, requestId: RequestId, onRecord }),
  );
  return onRecord;
}

function record(rating, category) {
  useStore.setState((state) => ({
    sessions: {
      ...state.sessions,
      [SessionId]: {
        ...state.sessions[SessionId],
        messageFeedback: {
          [RequestId]: { sessionId: SessionId, requestId: RequestId, rating, category, updatedAt: "x" },
        },
      },
    },
  }));
}

test("choosing a rating opens the category dialog and submits the chosen category", () => {
  const onRecord = renderControl();

  fireEvent.click(screen.getByRole("button", { name: frontendFeatureMessage("feedback.helpful") }));
  expect(screen.getByText(frontendFeatureMessage("feedback.dialog.title"))).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: frontendFeatureMessage("feedback.category.task_result") }));
  fireEvent.click(screen.getByRole("button", { name: frontendFeatureMessage("feedback.dialog.submit") }));

  expect(onRecord).toHaveBeenCalledWith(SessionId, RequestId, "positive", "task_result");
  expect(screen.queryByText(frontendFeatureMessage("feedback.dialog.title"))).not.toBeInTheDocument();
});

test("a bare rating submits without a category", () => {
  const onRecord = renderControl();

  fireEvent.click(screen.getByRole("button", { name: frontendFeatureMessage("feedback.notHelpful") }));
  fireEvent.click(screen.getByRole("button", { name: frontendFeatureMessage("feedback.dialog.submit") }));

  expect(onRecord).toHaveBeenCalledWith(SessionId, RequestId, "negative", undefined);
});

test("closing the dialog records nothing", () => {
  const onRecord = renderControl();

  fireEvent.click(screen.getByRole("button", { name: frontendFeatureMessage("feedback.helpful") }));
  fireEvent.click(screen.getByRole("button", { name: frontendMessage("ui.cancel") }));

  expect(onRecord).not.toHaveBeenCalled();
  expect(document.querySelector("[data-message-feedback]")).toHaveAttribute("data-message-feedback", "none");
});

test("clicking the recorded rating retracts it without opening the dialog", () => {
  record("positive");
  const onRecord = renderControl();

  fireEvent.click(screen.getByRole("button", { name: frontendFeatureMessage("feedback.helpful") }));

  expect(onRecord).toHaveBeenCalledWith(SessionId, RequestId, null);
  expect(screen.queryByText(frontendFeatureMessage("feedback.dialog.title"))).not.toBeInTheDocument();
});

test("the recorded rating is rendered from the durable record", () => {
  record("negative");
  renderControl();

  expect(document.querySelector("[data-message-feedback]")).toHaveAttribute("data-message-feedback", "negative");
  expect(screen.getByRole("button", { name: frontendFeatureMessage("feedback.notHelpful") })).toHaveClass(
    "text-brick-600",
  );
});

test("rating the other direction opens the dialog instead of retracting", () => {
  record("positive");
  const onRecord = renderControl();

  fireEvent.click(screen.getByRole("button", { name: frontendFeatureMessage("feedback.notHelpful") }));

  expect(onRecord).not.toHaveBeenCalled();
  expect(screen.getByText(frontendFeatureMessage("feedback.dialog.title"))).toBeInTheDocument();
});

test("a disabled control cannot start a rating", () => {
  const onRecord = vi.fn();
  renderWithFrontendProviders(
    React.createElement(MessageFeedbackControl, {
      sessionId: SessionId,
      requestId: RequestId,
      disabled: true,
      onRecord,
    }),
  );

  fireEvent.click(screen.getByRole("button", { name: frontendFeatureMessage("feedback.helpful") }));

  expect(onRecord).not.toHaveBeenCalled();
  expect(screen.queryByText(frontendFeatureMessage("feedback.dialog.title"))).not.toBeInTheDocument();
});

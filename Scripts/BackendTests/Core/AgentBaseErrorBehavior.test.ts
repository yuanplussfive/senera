import { describe, expect, it } from "vitest";
import { AgentBaseError } from "../../../Source/AgentSystem/Core/AgentBaseError.js";
import { AgentSessionRunCoordinatorShuttingDownError } from "../../../Source/AgentSystem/Session/AgentSessionActiveRunController.js";
import { AgentSessionCommandConflictError } from "../../../Source/AgentSystem/Session/AgentSessionCommand.js";
import { AgentMcpDescriptorError } from "../../../Source/AgentSystem/McpPackages/AgentMcpDescriptorAdapter.js";

class TestSimpleError extends AgentBaseError {
  constructor(message: string) {
    super(message);
  }
}

class TestErrorWithCause extends AgentBaseError {
  constructor(message: string, cause: unknown) {
    super(message, { cause });
  }
}

class TestErrorWithReadonlyField extends AgentBaseError {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

class TestNestedError extends TestSimpleError {
  constructor(message: string) {
    super(message);
  }
}

describe("AgentBaseError", () => {
  describe("name auto-assignment", () => {
    it("sets this.name to the subclass constructor name", () => {
      const error = new TestSimpleError("something broke");
      expect(error.name).toBe("TestSimpleError");
    });

    it("sets this.name for subclasses with readonly fields", () => {
      const error = new TestErrorWithReadonlyField("disk full", "E_DISK");
      expect(error.name).toBe("TestErrorWithReadonlyField");
      expect(error.code).toBe("E_DISK");
    });

    it("sets this.name for deeply nested subclasses", () => {
      const error = new TestNestedError("nested failure");
      expect(error.name).toBe("TestNestedError");
    });

    it("sets this.name for subclasses passing ErrorOptions", () => {
      const cause = new Error("root cause");
      const error = new TestErrorWithCause("wrapper", cause);
      expect(error.name).toBe("TestErrorWithCause");
    });
  });

  describe("Error inheritance", () => {
    it("is an instance of Error", () => {
      const error = new TestSimpleError("msg");
      expect(error).toBeInstanceOf(Error);
    });

    it("is an instance of AgentBaseError", () => {
      const error = new TestSimpleError("msg");
      expect(error).toBeInstanceOf(AgentBaseError);
    });

    it("nested subclasses are instances of both AgentBaseError and parent", () => {
      const error = new TestNestedError("msg");
      expect(error).toBeInstanceOf(AgentBaseError);
      expect(error).toBeInstanceOf(TestSimpleError);
    });
  });

  describe("message and cause", () => {
    it("preserves the message", () => {
      const error = new TestSimpleError("detailed failure message");
      expect(error.message).toBe("detailed failure message");
    });

    it("preserves the cause chain", () => {
      const cause = new Error("root");
      const error = new TestErrorWithCause("wrapper", cause);
      expect(error.cause).toBe(cause);
    });
  });

  describe("stack trace", () => {
    it("has a stack trace", () => {
      const error = new TestSimpleError("msg");
      expect(error.stack).toBeTruthy();
      expect(error.stack).toContain("TestSimpleError");
    });
  });

  describe("toString", () => {
    it("produces 'ClassName: message' format", () => {
      const error = new TestSimpleError("boom");
      expect(error.toString()).toBe("TestSimpleError: boom");
    });
  });

  describe("production error compliance", () => {
    it("AgentSessionRunCoordinatorShuttingDownError inherits AgentBaseError with auto-name", () => {
      const error = new AgentSessionRunCoordinatorShuttingDownError();
      expect(error).toBeInstanceOf(AgentBaseError);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe("AgentSessionRunCoordinatorShuttingDownError");
      expect(error.message).toBe("Session run coordinator is shutting down.");
    });

    it("AgentSessionCommandConflictError inherits AgentBaseError with auto-name and readonly fields", () => {
      const expected = { operationKind: "message", payloadHash: "abc", requestId: "req-1" };
      const received = { operationKind: "message", payloadHash: "def", requestId: "req-2" };
      const error = new AgentSessionCommandConflictError("sess-1", "cmd-1", expected, received);
      expect(error).toBeInstanceOf(AgentBaseError);
      expect(error.name).toBe("AgentSessionCommandConflictError");
      expect(error.sessionId).toBe("sess-1");
      expect(error.commandId).toBe("cmd-1");
      expect(error.expected).toBe(expected);
      expect(error.received).toBe(received);
    });

    it("AgentMcpDescriptorError inherits AgentBaseError with auto-name and path field", () => {
      const error = new AgentMcpDescriptorError("invalid descriptor", ["servers", 0, "name"]);
      expect(error).toBeInstanceOf(AgentBaseError);
      expect(error.name).toBe("AgentMcpDescriptorError");
      expect(error.message).toBe("invalid descriptor");
      expect(error.path).toEqual(["servers", 0, "name"]);
    });
  });
});

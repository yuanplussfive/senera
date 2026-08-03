import { describe, expect, it } from "vitest";
import { AgentBaseError } from "../../../Source/AgentSystem/Core/AgentBaseError.js";

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
});

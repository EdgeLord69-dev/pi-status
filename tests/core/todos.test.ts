import { describe, expect, it } from "vitest";
import { parseTodoDetails, reconstructTodos } from "../../src/core/todos.ts";

const result = (details: unknown, overrides: Record<string, unknown> = {}) => ({
  type: "message",
  message: {
    role: "toolResult",
    toolName: "todo",
    isError: false,
    details,
    ...overrides,
  },
});

describe("TODO snapshots", () => {
  it("normalizes old and new detail shapes", () => {
    expect(
      parseTodoDetails({
        todos: [
          { id: 1, text: "first", done: false },
          { id: 2, text: "second", done: true },
        ],
        nextId: 3,
      }),
    ).toEqual([
      { id: 1, text: "first", status: "pending" },
      { id: 2, text: "second", status: "completed" },
    ]);
    expect(
      parseTodoDetails({
        tasks: [
          { id: 3, subject: "third", status: "in_progress" },
          { id: 4, subject: "fourth", status: "completed" },
        ],
      }),
    ).toEqual([
      { id: 3, text: "third", status: "in_progress" },
      { id: 4, text: "fourth", status: "completed" },
    ]);
  });

  it("rejects malformed entries individually and bounds IDs", () => {
    expect(
      parseTodoDetails({
        tasks: [
          { id: 1, subject: "valid", status: "pending" },
          {
            id: Number.MAX_SAFE_INTEGER + 1,
            subject: "too large",
            status: "pending",
          },
          { id: 2, subject: 42, status: "pending" },
          { id: 3, subject: "bad status", status: "blocked" },
        ],
      }),
    ).toEqual([{ id: 1, text: "valid", status: "pending" }]);
    expect(parseTodoDetails({ nope: [] })).toBeUndefined();
  });

  it("uses the latest valid successful branch result", () => {
    const branch = [
      result({ todos: [{ id: 1, text: "old", done: false }] }),
      result(
        { tasks: [{ id: 2, subject: "ignored error", status: "pending" }] },
        { isError: true },
      ),
      result({ malformed: true }),
      result({ tasks: [{ id: 3, subject: "latest", status: "completed" }] }),
    ];
    expect(reconstructTodos(branch)).toEqual([
      { id: 3, text: "latest", status: "completed" },
    ]);
  });

  it("treats a valid empty latest result as authoritative", () => {
    expect(
      reconstructTodos([
        result({ todos: [{ id: 1, text: "old", done: false }] }),
        result({ tasks: [] }),
      ]),
    ).toEqual([]);
  });
});
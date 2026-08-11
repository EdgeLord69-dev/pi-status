import type { NormalizedTodo } from "../shared/types.ts";

const VALID_STATUSES = new Set<NormalizedTodo["status"]>([
  "pending",
  "in_progress",
  "completed",
]);
const MAX_TODO_ITEMS = 2048;

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;

function normalizeTodo(
  value: unknown,
  oldShape: boolean,
): NormalizedTodo | undefined {
  const item = record(value);
  if (!item) return undefined;
  const id = item.id;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 0)
    return undefined;
  if (oldShape) {
    if (typeof item.text !== "string" || typeof item.done !== "boolean")
      return undefined;
    return {
      id,
      text: item.text,
      status: item.done ? "completed" : "pending",
    };
  }
  if (
    typeof item.subject !== "string" ||
    typeof item.status !== "string" ||
    !VALID_STATUSES.has(item.status as NormalizedTodo["status"])
  ) {
    return undefined;
  }
  return {
    id,
    text: item.subject,
    status: item.status as NormalizedTodo["status"],
  };
}

export function parseTodoDetails(
  details: unknown,
): NormalizedTodo[] | undefined {
  const source = record(details);
  if (!source) return undefined;
  const oldShape = Array.isArray(source.todos);
  const items = oldShape
    ? source.todos
    : Array.isArray(source.tasks)
      ? source.tasks
      : undefined;
  if (!items) return undefined;
  return (items as readonly unknown[])
    .slice(0, MAX_TODO_ITEMS)
    .map((item) => normalizeTodo(item, oldShape))
    .filter((item): item is NormalizedTodo => item !== undefined);
}

export function reconstructTodos(branch: readonly unknown[]): NormalizedTodo[] {
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = record(branch[index]);
    const message =
      entry?.type === "message" ? record(entry.message) : undefined;
    if (
      message?.role !== "toolResult" ||
      message.toolName !== "todo" ||
      message.isError === true
    ) {
      continue;
    }
    const parsed = parseTodoDetails(message.details);
    if (parsed !== undefined) return parsed;
  }
  return [];
}
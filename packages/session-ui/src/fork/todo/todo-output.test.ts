import { describe, expect, test } from "bun:test"
import { todoItems } from "./todo-output"

describe("todoItems", () => {
  test("keeps valid items and defaults unknown statuses to pending", () => {
    expect(
      todoItems({
        todos: [
          { content: "Write", status: "completed" },
          { content: "Review", status: "in_progress", activeForm: "Reviewing" },
          { content: "Ship", status: "soon" },
        ],
      }),
    ).toEqual([
      { content: "Write", status: "completed", activeForm: undefined },
      { content: "Review", status: "in_progress", activeForm: "Reviewing" },
      { content: "Ship", status: "pending", activeForm: undefined },
    ])
  })

  test("ignores malformed input while the call is still streaming", () => {
    expect(todoItems({})).toEqual([])
    expect(todoItems({ todos: "nope" })).toEqual([])
    expect(todoItems({ todos: [null, 3, { status: "pending" }, { content: "", status: "pending" }] })).toEqual([])
  })
})

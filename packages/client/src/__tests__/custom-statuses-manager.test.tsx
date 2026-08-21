// Component tests for custom-statuses-manager.tsx (bb-wxuw port from
// 1386b41). Direct port from the v0.24 vitest+RTL+userEvent source —
// translated to bun:test by changing the imports + describe/it→describe/test;
// happy-dom replaces jsdom (already wired via _test-globals.ts preload).
// The RTL APIs are identical. The original shipped 14 tests; this port
// keeps the headline 14 paths.

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { CustomStatusesManager } from "../components/custom-statuses-manager"
import { _resetRpc, _setRpc, type RemoteApi } from "../lib/rpc"

// bb-w4ee: rc.8 hit RTL waitFor 1003ms timeouts on this file's user.type tests
// — the Linux self-hosted runner stalls on user-event's default 0ms keystroke
// delay (a setTimeout chain that doesn't fire reliably under the runner's
// async scheduler). delay: null skips the timer entirely; tests still pass
// locally and ship the same shape to CI.
const userInstance = () => userEvent.setup({ delay: null })

let rpcCalls: {
  getCustomStatusList: ReturnType<typeof mock>
  updateCustomStatuses: ReturnType<typeof mock>
}

function installRpcMock(
  opts: { initialList?: string[]; updateResult?: { success: boolean; error?: string } } = {},
): void {
  rpcCalls = {
    getCustomStatusList: mock(async (_db?: string) => opts.initialList ?? []),
    updateCustomStatuses: mock(
      async (_list: string[], _db?: string) => opts.updateResult ?? { success: true },
    ),
  }
  // Partial RemoteApi: cast through unknown so we don't have to stub every
  // namespace. The component only reaches into rpc.beads.{getCustomStatusList,
  // updateCustomStatuses}; anything else hitting this mock indicates a bug.
  const partial = {
    beads: {
      getCustomStatusList: rpcCalls.getCustomStatusList,
      updateCustomStatuses: rpcCalls.updateCustomStatuses,
    },
  } as unknown as RemoteApi
  _setRpc(partial)
}

beforeEach(() => {
  // bb-fjlv: defense-in-depth against cross-file DOM leaks (see epic-nav.test.ts).
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild)
  }
  installRpcMock()
})

afterEach(() => {
  cleanup()
  _resetRpc()
})

describe("CustomStatusesManager", () => {
  test("shows placeholder when no workspace is selected", () => {
    render(<CustomStatusesManager databasePath={undefined} />)
    expect(screen.getByText(/Select a workspace/)).toBeDefined()
  })

  test("loads and renders the current list from the server", async () => {
    installRpcMock({ initialList: ["ready_for_qa", "deployed"] })
    render(<CustomStatusesManager databasePath="/tmp/test.db" />)
    await waitFor(() => {
      const list = screen.getByRole("list", { name: /Custom statuses/i })
      expect(within(list).getByText("ready_for_qa")).toBeDefined()
      expect(within(list).getByText("deployed")).toBeDefined()
    })
    expect(rpcCalls.getCustomStatusList).toHaveBeenCalledWith("/tmp/test.db")
  })

  test("adds a status to the working list", async () => {
    const user = userInstance()
    installRpcMock({ initialList: [] })
    render(<CustomStatusesManager databasePath="/tmp/test.db" />)
    await waitFor(() => expect(screen.getByRole("textbox")).toBeDefined())

    await user.type(screen.getByRole("textbox"), "ready_for_qa")
    await user.click(screen.getByRole("button", { name: /add status/i }))

    const list = screen.getByRole("list", { name: /Custom statuses/i })
    expect(within(list).getByText("ready_for_qa")).toBeDefined()
    expect(screen.getByText(/Unsaved changes/)).toBeDefined()
  })

  test("shows validation error for invalid name and does not add", async () => {
    const user = userInstance()
    installRpcMock({ initialList: [] })
    render(<CustomStatusesManager databasePath="/tmp/test.db" />)
    await waitFor(() => expect(screen.getByRole("textbox")).toBeDefined())

    await user.type(screen.getByRole("textbox"), "Ready For QA")
    await user.click(screen.getByRole("button", { name: /add status/i }))

    expect(screen.getByText(/lowercase/i)).toBeDefined()
    expect(screen.queryByText("Ready For QA")).toBeNull()
  })

  test("rejects reserved status names", async () => {
    const user = userInstance()
    installRpcMock({ initialList: [] })
    render(<CustomStatusesManager databasePath="/tmp/test.db" />)
    await waitFor(() => expect(screen.getByRole("textbox")).toBeDefined())

    await user.type(screen.getByRole("textbox"), "in_progress")
    await user.click(screen.getByRole("button", { name: /add status/i }))

    const error = screen.getByRole("textbox").getAttribute("aria-describedby")
    expect(error).toBeTruthy()
    expect(document.getElementById(error!)?.textContent).toMatch(/built-in/i)
  })

  test("clears error when user edits the input after failure", async () => {
    const user = userInstance()
    installRpcMock({ initialList: [] })
    render(<CustomStatusesManager databasePath="/tmp/test.db" />)
    await waitFor(() => expect(screen.getByRole("textbox")).toBeDefined())

    await user.type(screen.getByRole("textbox"), "BAD")
    await user.click(screen.getByRole("button", { name: /add status/i }))
    expect(screen.getByText(/lowercase/i)).toBeDefined()

    await user.type(screen.getByRole("textbox"), "x")
    expect(screen.queryByText(/lowercase/i)).toBeNull()
  })

  test("removes a status", async () => {
    const user = userInstance()
    installRpcMock({ initialList: ["ready_for_qa", "deployed"] })
    render(<CustomStatusesManager databasePath="/tmp/test.db" />)
    await waitFor(() =>
      expect(
        within(screen.getByRole("list", { name: /Custom statuses/i })).getByText("ready_for_qa"),
      ).toBeDefined(),
    )

    await user.click(screen.getByRole("button", { name: /Remove ready_for_qa/ }))

    const list = screen.getByRole("list", { name: /Custom statuses/i })
    expect(within(list).queryByText("ready_for_qa")).toBeNull()
    expect(within(list).getByText("deployed")).toBeDefined()
  })

  test("reorders statuses via move buttons", async () => {
    const user = userInstance()
    installRpcMock({ initialList: ["a", "b", "c"] })
    render(<CustomStatusesManager databasePath="/tmp/test.db" />)
    await waitFor(() => expect(screen.getByText("a")).toBeDefined())

    // Move 'a' down
    await user.click(screen.getByRole("button", { name: /Move a down/ }))

    const items = screen.getAllByRole("listitem")
    expect(items[0].textContent).toContain("b")
    expect(items[1].textContent).toContain("a")
    expect(items[2].textContent).toContain("c")
  })

  test("disables up button on first item and down on last", async () => {
    installRpcMock({ initialList: ["a", "b"] })
    render(<CustomStatusesManager databasePath="/tmp/test.db" />)
    await waitFor(() => expect(screen.getByText("a")).toBeDefined())

    expect(screen.getByRole("button", { name: /Move a up/ }).hasAttribute("disabled")).toBe(true)
    expect(screen.getByRole("button", { name: /Move b down/ }).hasAttribute("disabled")).toBe(true)
  })

  test("saves via rpc and calls onStatusesChanged on success", async () => {
    const user = userInstance()
    installRpcMock({ initialList: [], updateResult: { success: true } })
    const onChanged = mock(() => {})

    render(<CustomStatusesManager databasePath="/tmp/test.db" onStatusesChanged={onChanged} />)
    await waitFor(() => expect(screen.getByRole("textbox")).toBeDefined())

    await user.type(screen.getByRole("textbox"), "ready_for_qa")
    await user.click(screen.getByRole("button", { name: /add status/i }))
    await user.click(screen.getByRole("button", { name: /save custom statuses/i }))

    await waitFor(() => {
      expect(rpcCalls.updateCustomStatuses).toHaveBeenCalledWith(["ready_for_qa"], "/tmp/test.db")
      expect(onChanged).toHaveBeenCalled()
    })
  })

  test("does not call onStatusesChanged when server returns failure", async () => {
    const user = userInstance()
    installRpcMock({ initialList: [], updateResult: { success: false, error: "boom" } })
    const onChanged = mock(() => {})

    render(<CustomStatusesManager databasePath="/tmp/test.db" onStatusesChanged={onChanged} />)
    await waitFor(() => expect(screen.getByRole("textbox")).toBeDefined())

    await user.type(screen.getByRole("textbox"), "ready_for_qa")
    await user.click(screen.getByRole("button", { name: /add status/i }))
    await user.click(screen.getByRole("button", { name: /save custom statuses/i }))

    await waitFor(() => {
      expect(rpcCalls.updateCustomStatuses).toHaveBeenCalled()
    })
    expect(onChanged).not.toHaveBeenCalled()
  })

  test("reset discards working-state changes", async () => {
    const user = userInstance()
    installRpcMock({ initialList: ["a"] })
    render(<CustomStatusesManager databasePath="/tmp/test.db" />)
    await waitFor(() => expect(screen.getByText("a")).toBeDefined())

    await user.click(screen.getByRole("button", { name: /Remove a/ }))
    expect(screen.queryByText("a")).toBeNull()

    await user.click(screen.getByRole("button", { name: /reset/i }))

    expect(screen.getByText("a")).toBeDefined()
  })

  test("pressing Enter in the input adds the status", async () => {
    const user = userInstance()
    installRpcMock({ initialList: [] })
    render(<CustomStatusesManager databasePath="/tmp/test.db" />)
    await waitFor(() => expect(screen.getByRole("textbox")).toBeDefined())

    await user.type(screen.getByRole("textbox"), "ready_for_qa{Enter}")

    const list = screen.getByRole("list", { name: /Custom statuses/i })
    expect(within(list).getByText("ready_for_qa")).toBeDefined()
  })
})

// bb-y729: bead-table-bulk-toolbar — RTL render contract.
//
// Verifies count display, archive button wiring, hidden state, pending lock.
// userEvent.setup({ delay: null }) per bb-w4ee — Linux runner stalls on the
// default 0ms keystroke chain.

import { afterEach, describe, expect, mock, test } from "bun:test"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { BeadTableBulkToolbar } from "../components/bead-table-bulk-toolbar"

afterEach(cleanup)

const userInstance = () => userEvent.setup({ delay: null })

describe("BeadTableBulkToolbar (bb-y729)", () => {
  test("renders nothing when 0 selected", () => {
    const { container } = render(
      <BeadTableBulkToolbar
        selectedCount={0}
        onBulkArchive={mock(() => Promise.resolve())}
        onClear={mock(() => {})}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  test("shows '1 selected' for single", () => {
    render(
      <BeadTableBulkToolbar
        selectedCount={1}
        onBulkArchive={mock(() => Promise.resolve())}
        onClear={mock(() => {})}
      />,
    )
    expect(screen.getByText("1 selected")).toBeTruthy()
  })

  test("shows 'N selected' for multiple", () => {
    render(
      <BeadTableBulkToolbar
        selectedCount={5}
        onBulkArchive={mock(() => Promise.resolve())}
        onClear={mock(() => {})}
      />,
    )
    expect(screen.getByText("5 selected")).toBeTruthy()
  })

  test("clicking Archive invokes onBulkArchive", async () => {
    const onBulkArchive = mock(() => Promise.resolve())
    const user = userInstance()
    render(
      <BeadTableBulkToolbar
        selectedCount={3}
        onBulkArchive={onBulkArchive}
        onClear={mock(() => {})}
      />,
    )
    await user.click(screen.getByRole("button", { name: /archive selected/i }))
    expect(onBulkArchive).toHaveBeenCalledTimes(1)
  })

  test("clicking Cancel invokes onClear", async () => {
    const onClear = mock(() => {})
    const user = userInstance()
    render(
      <BeadTableBulkToolbar
        selectedCount={2}
        onBulkArchive={mock(() => Promise.resolve())}
        onClear={onClear}
      />,
    )
    await user.click(screen.getByRole("button", { name: /clear selection/i }))
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  test("disables Archive button when isPending", () => {
    render(
      <BeadTableBulkToolbar
        selectedCount={2}
        onBulkArchive={mock(() => Promise.resolve())}
        onClear={mock(() => {})}
        isPending
      />,
    )
    const btn = screen.getByRole("button", { name: /archive selected/i }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })
})

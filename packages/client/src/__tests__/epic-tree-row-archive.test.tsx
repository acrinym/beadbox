// beadbox-7xr: row-level Archive button on epic rows.
//
// Citation: pm/spec.md §4.2 'Epic Tree' — "Each epic row shows: ...
// Archive button (row-level affordance; clicking applies the `archived`
// label via bd update <id> --add-label archived and the row moves to the
// Archived section per §4.2 ordering). ... Distinct from the right-click
// context menu's `archive` action ... Both target the same underlying bd
// write."
//
// Test surface: render EpicTree with a small fixture, find the archive
// button by aria-label, click it, assert onArchive is called with
// (epicId, true). Also verify gates: not rendered for the standalone
// pseudo-epic, not rendered for already-archived rows.

import { afterEach, describe, expect, mock, test } from "bun:test"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { EpicTree } from "../components/epic-tree"
import type { Bead, Epic } from "../lib/types"

afterEach(cleanup)

const userInstance = () => userEvent.setup({ delay: null })

// Minimal Epic fixture. Fills in just enough for the row to render.
function makeEpic(over: Partial<Epic> = {}): Epic {
  return {
    id: "bb-epic-1",
    title: "Test Epic",
    description: "",
    status: "open",
    priority: 2,
    type: "epic",
    assignee: "",
    labels: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    comments: [],
    children: [] as Bead[],
    childEpics: [],
    commentCount: 0,
    ...over,
  } as Epic
}

describe("EpicRow row-level Archive button (beadbox-7xr)", () => {
  test("renders Archive button on an active epic row", () => {
    render(
      <EpicTree
        epics={[makeEpic({ id: "bb-e1", title: "Active Epic" })]}
        expandedEpics={new Set()}
        onToggleEpic={mock(() => {})}
        onBeadClick={mock(() => {})}
        onArchive={mock(() => {})}
      />,
    )
    expect(screen.getByLabelText("Archive epic: Active Epic")).toBeTruthy()
  })

  test("clicking Archive invokes onArchive with (epicId, true)", async () => {
    const onArchive = mock(() => {})
    const user = userInstance()
    render(
      <EpicTree
        epics={[makeEpic({ id: "bb-e2", title: "Clickable Epic" })]}
        expandedEpics={new Set()}
        onToggleEpic={mock(() => {})}
        onBeadClick={mock(() => {})}
        onArchive={onArchive}
      />,
    )
    const button = screen.getByLabelText("Archive epic: Clickable Epic")
    await user.click(button)
    expect(onArchive).toHaveBeenCalledTimes(1)
    expect(onArchive).toHaveBeenCalledWith("bb-e2", true)
  })

  test("does NOT render Archive button on rows in the Archived section", () => {
    render(
      <EpicTree
        epics={[]}
        archivedEpics={[makeEpic({ id: "bb-e3", title: "Archived Epic" })]}
        expandedEpics={new Set()}
        onToggleEpic={mock(() => {})}
        onBeadClick={mock(() => {})}
        onArchive={mock(() => {})}
      />,
    )
    expect(screen.queryByLabelText("Archive epic: Archived Epic")).toBeNull()
  })

  test("does NOT render Archive button when onArchive prop is absent", () => {
    render(
      <EpicTree
        epics={[makeEpic({ id: "bb-e4", title: "No-Callback Epic" })]}
        expandedEpics={new Set()}
        onToggleEpic={mock(() => {})}
        onBeadClick={mock(() => {})}
      />,
    )
    expect(screen.queryByLabelText("Archive epic: No-Callback Epic")).toBeNull()
  })

  test("Archive button click does NOT trigger the row's onBeadClick (stopPropagation)", async () => {
    const onArchive = mock(() => {})
    const onBeadClick = mock(() => {})
    const user = userInstance()
    render(
      <EpicTree
        epics={[makeEpic({ id: "bb-e5", title: "Isolated Click Epic" })]}
        expandedEpics={new Set()}
        onToggleEpic={mock(() => {})}
        onBeadClick={onBeadClick}
        onArchive={onArchive}
      />,
    )
    const button = screen.getByLabelText("Archive epic: Isolated Click Epic")
    await user.click(button)
    expect(onArchive).toHaveBeenCalledTimes(1)
    expect(onBeadClick).not.toHaveBeenCalled()
  })

  // beadbox-buu: the original beadbox-7xr sweep missed the recursive
  // EpicRow call site at epic-tree.tsx:1430 — onArchiveEpic wasn't
  // threaded to nested child-epic rows, silently hiding the button on
  // any epic-with-children. Test below renders an expanded parent epic
  // and asserts the archive button appears on BOTH the parent AND its
  // nested child epic.
  test("renders Archive button on nested child-epic rows (beadbox-buu regression guard)", async () => {
    const onArchive = mock(() => {})
    const user = userInstance()
    const child = makeEpic({ id: "bb-child", title: "Nested Child Epic" })
    const parent = makeEpic({
      id: "bb-parent",
      title: "Parent Epic",
      childEpics: [child],
    })
    render(
      <EpicTree
        epics={[parent]}
        // Pre-expand the parent so the child renders into the DOM.
        expandedEpics={new Set(["bb-parent"])}
        onToggleEpic={mock(() => {})}
        onBeadClick={mock(() => {})}
        onArchive={onArchive}
      />,
    )
    // Both rows show the archive button.
    expect(screen.getByLabelText("Archive epic: Parent Epic")).toBeTruthy()
    const childButton = screen.getByLabelText("Archive epic: Nested Child Epic")
    expect(childButton).toBeTruthy()
    // Clicking the nested-epic button calls onArchive with the CHILD'S id.
    await user.click(childButton)
    expect(onArchive).toHaveBeenCalledTimes(1)
    expect(onArchive).toHaveBeenCalledWith("bb-child", true)
  })
})

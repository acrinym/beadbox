# Trains in Beadbox

`.beadtrain` files next to beads are execution plans. This tab lists them, shows ready cars, and shows coupler joins.

- Tickets stay in `bd`. Closing a bead is what marks a car done.
- Ready-set matches the Beadtrains CLI: local `depends_on`, then coupler `after` / `with`.
- Status comes from `bd` (the source of truth); `.beads/issues.jsonl` is only a fallback when `bd` is unavailable.
- Click a car id to open that bead on the Beads tab.
- The Trains tab and ⌘4 / Ctrl+4 appear only when the active workspace contains `.beadtrain` files; with none, there is no footprint.

CLI (same rules): https://github.com/acrinym/Beadtrains

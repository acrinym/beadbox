# Trains in Beadbox

`.beadtrain` files next to beads are execution plans. This tab lists them, shows ready cars, and shows coupler joins.

- Tickets stay in `bd`. Closing a bead is what marks a car done.
- Ready-set matches the Beadtrains CLI: local `depends_on`, then coupler `after` / `with`.
- Status comes from `.beads/issues.jsonl` when present, otherwise `bd list`.
- Click a car id to open that bead on the Beads tab.
- Keyboard: ⌘4 / Ctrl+4.

CLI (same rules): https://github.com/acrinym/Beadtrains

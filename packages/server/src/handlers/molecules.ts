// Molecules handler namespace. Mirrors the single export of actions/molecules.ts.

import { getMoleculeStructure } from "../lib/bd"
import type { MoleculeGraph } from "../lib/types"

export async function loadMoleculeGraph(
  beadId: string,
  dbPath?: string,
): Promise<{ success: true; graph: MoleculeGraph } | { success: false; error: string }> {
  try {
    const graph = await getMoleculeStructure(beadId, dbPath ? { db: dbPath } : {})
    return { success: true, graph }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to load molecule graph"
    return { success: false, error: message }
  }
}

// Source-local copy of lib/port-scan.ts (P1.3 / bb-vy13.3).
// Verbatim — only ./types import was already relative.

import mysql from "mysql2/promise"
import type { ScanResult } from "./types"

const BATCH_SIZE = 20
const CONNECT_TIMEOUT_MS = 200
const VERIFY_TIMEOUT_MS = 500
const HOST = "127.0.0.1"

// Connection-level error codes that indicate no server is listening.
// Any other error (e.g. auth failure) means a MySQL-protocol server responded.
const CONNECTION_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
])

async function probePort(port: number): Promise<boolean> {
  let connection: Awaited<ReturnType<typeof mysql.createConnection>> | null = null
  try {
    connection = await mysql.createConnection({
      host: HOST,
      port,
      connectTimeout: CONNECT_TIMEOUT_MS,
    })
    // Verify this is actually a Dolt server, not vanilla MySQL/MariaDB
    const [rows] = await Promise.race([
      connection.query("SELECT @@dolt_version AS v"),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("verify timeout")), VERIFY_TIMEOUT_MS),
      ),
    ])
    const version = (rows as Array<{ v: string }>)?.[0]?.v
    return typeof version === "string" && version.length > 0
  } catch (err: unknown) {
    const code = (err as { code?: string }).code
    if (code && CONNECTION_ERROR_CODES.has(code)) {
      return false
    }
    // Connected but not Dolt (auth error on non-Dolt, or @@dolt_version unknown)
    return false
  } finally {
    if (connection) {
      connection.end().catch(() => {})
    }
  }
}

export async function scanPorts(ports: number[]): Promise<ScanResult[]> {
  const unique = [...new Set(ports)]
  const results: ScanResult[] = []

  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const batch = unique.slice(i, i + BATCH_SIZE)
    const probes = await Promise.allSettled(
      batch.map(async (port) => {
        const found = await probePort(port)
        return { port, found }
      }),
    )

    for (const result of probes) {
      if (result.status === "fulfilled" && result.value.found) {
        results.push({ host: HOST, port: result.value.port })
      }
    }
  }

  return results
}

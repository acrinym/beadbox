/** Minimal TOML reader for v1.3 .beadtrain files. Not a general TOML library. */

export type TomlScalar = string | boolean | number
export type TomlValue = TomlScalar | TomlScalar[] | TomlTable | TomlTable[]
export type TomlTable = { [key: string]: TomlValue }

function unquote(raw: string): string {
  const trimmed = raw.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"')
  }
  if (trimmed === "true") return "true"
  if (trimmed === "false") return "false"
  return trimmed
}

function parseScalar(raw: string): TomlScalar {
  const trimmed = raw.trim()
  if (trimmed === "true") return true
  if (trimmed === "false") return false
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed)
  return unquote(trimmed)
}

function parseStringArray(raw: string): string[] {
  const inner = raw.trim().replace(/^\[/, "").replace(/\]$/, "").trim()
  if (!inner) return []
  const parts: string[] = []
  let buf = ""
  let inQuote = false
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i]
    if (ch === '"' && inner[i - 1] !== "\\") {
      inQuote = !inQuote
      buf += ch
      continue
    }
    if (ch === "," && !inQuote) {
      if (buf.trim()) parts.push(String(parseScalar(buf)))
      buf = ""
      continue
    }
    buf += ch
  }
  if (buf.trim()) parts.push(String(parseScalar(buf)))
  return parts
}

function arrayIsClosed(raw: string): boolean {
  let quote: '"' | "'" | null = null
  let escaped = false
  for (const ch of raw) {
    if (escaped) {
      escaped = false
      continue
    }
    if (quote === '"' && ch === "\\") {
      escaped = true
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = quote === ch ? null : quote ?? ch
      continue
    }
    if (ch === "]" && quote === null) return true
  }
  return false
}

function assignPath(root: TomlTable, path: string[], value: TomlValue): void {
  let cursor: TomlTable = root
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i]
    const next = cursor[key]
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      cursor[key] = {}
    }
    cursor = cursor[key] as TomlTable
  }
  cursor[path[path.length - 1]] = value
}

function ensureArrayTable(root: TomlTable, name: string): TomlTable {
  const existing = root[name]
  if (!Array.isArray(existing)) {
    root[name] = []
  }
  const row: TomlTable = {}
  ;(root[name] as TomlTable[]).push(row)
  return row
}

export function parseBeadtrainToml(source: string): TomlTable {
  const root: TomlTable = {}
  let current: TomlTable = root
  const lines = source.replace(/^\uFEFF/, "").split(/\r?\n/)
  let i = 0
  while (i < lines.length) {
    const raw = lines[i]
    i += 1
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue

    const arrayHeader = line.match(/^\[\[([A-Za-z0-9_]+)\]\]$/)
    if (arrayHeader) {
      current = ensureArrayTable(root, arrayHeader[1])
      continue
    }
    const tableHeader = line.match(/^\[([A-Za-z0-9_.]+)\]$/)
    if (tableHeader) {
      const path = tableHeader[1].split(".")
      assignPath(root, path, {})
      let cursor: TomlTable = root
      for (const key of path) {
        cursor = cursor[key] as TomlTable
      }
      current = cursor
      continue
    }

    const eq = line.indexOf("=")
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    let rhs = line.slice(eq + 1).trim()

    if (rhs.startsWith('"""')) {
      if (rhs.endsWith('"""') && rhs.length > 3) {
        current[key] = rhs.slice(3, -3).replace(/\\$/gm, "").trim()
        continue
      }
      const chunks: string[] = [rhs.slice(3)]
      while (i < lines.length) {
        const next = lines[i]
        i += 1
        const trimmedEnd = next.trimEnd()
        if (trimmedEnd.endsWith('"""')) {
          chunks.push(trimmedEnd.slice(0, -3))
          break
        }
        chunks.push(next)
      }
      current[key] = chunks.join("\n").replace(/\\\n/g, "").trim()
      continue
    }

    if (rhs.startsWith("[")) {
      while (!arrayIsClosed(rhs) && i < lines.length) {
        const next = lines[i]
        i += 1
        rhs += `\n${next}`
      }
      current[key] = parseStringArray(rhs)
      continue
    }

    current[key] = parseScalar(rhs)
  }
  return root
}

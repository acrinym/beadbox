// Unit tests for parity-canonicalize.ts.
//
// Drift detection of canonicalization itself: if the helpers ever change
// behavior, these tests catch it before silent parity drift propagates
// through the runner.

import { describe, expect, test } from "bun:test"
import { canonicalize, canonicalizeError, formatDiff } from "./parity-canonicalize"

describe("canonicalize: rule 1 (sort object keys)", () => {
  test("flat object keys sorted alphabetically", () => {
    const got = canonicalize({ z: 1, a: 2, m: 3 })
    expect(JSON.stringify(got)).toBe('{"a":2,"m":3,"z":1}')
  })

  test("nested objects sorted at every level", () => {
    const got = canonicalize({ b: { z: 1, a: 2 }, a: { y: 3, b: 4 } })
    expect(JSON.stringify(got)).toBe('{"a":{"b":4,"y":3},"b":{"a":2,"z":1}}')
  })
})

describe("canonicalize: rule 2 (Date to second-precision ISO)", () => {
  test("Date with millis -> ISO seconds Z", () => {
    const d = new Date("2026-04-25T12:34:56.789Z")
    expect(canonicalize(d)).toBe("2026-04-25T12:34:56Z")
  })

  test("Date inside object", () => {
    const got = canonicalize({ at: new Date("2026-04-25T00:00:00.500Z") }) as Record<
      string,
      unknown
    >
    expect(got.at).toBe("2026-04-25T00:00:00Z")
  })

  test("invalid Date -> null", () => {
    expect(canonicalize(new Date("not a date"))).toBe(null)
  })
})

describe("canonicalize: rule 3 (null/undefined collapse)", () => {
  test("undefined -> null", () => {
    expect(canonicalize(undefined)).toBe(null)
  })

  test("null -> null", () => {
    expect(canonicalize(null)).toBe(null)
  })

  test("undefined inside object becomes null", () => {
    const got = canonicalize({ a: undefined, b: 2 })
    expect(JSON.stringify(got)).toBe('{"a":null,"b":2}')
  })
})

describe("canonicalize: rule 4 (unordered array fields)", () => {
  test("labels reordered to canonical form", () => {
    const a = canonicalize({ labels: ["zebra", "apple", "mango"] })
    const b = canonicalize({ labels: ["apple", "mango", "zebra"] })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  test("regular array order preserved (NOT under unordered field name)", () => {
    const got = canonicalize({ items: ["c", "a", "b"] }) as Record<string, unknown>
    expect(got.items).toEqual(["c", "a", "b"])
  })

  test("children with id sorted by id", () => {
    const a = canonicalize({ children: [{ id: "z-2" }, { id: "a-1" }] })
    const b = canonicalize({ children: [{ id: "a-1" }, { id: "z-2" }] })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})

describe("canonicalize: rule 5 (float rounding)", () => {
  test("integer untouched", () => {
    expect(canonicalize(42)).toBe(42)
  })

  test("float rounded to 6 decimals", () => {
    expect(canonicalize(0.1234567891234)).toBe(0.123457)
  })

  test("very small float survives", () => {
    expect(canonicalize(0.000001)).toBe(0.000001)
  })

  test("Infinity / NaN -> null", () => {
    expect(canonicalize(Infinity)).toBe(null)
    expect(canonicalize(NaN)).toBe(null)
  })
})

describe("canonicalize: idempotent (canonicalize(canonicalize(x)) === canonicalize(x))", () => {
  test("complex nested structure", () => {
    const input = {
      z: { y: 1, x: undefined },
      a: [3, 1, 2],
      labels: ["b", "a"],
      ts: new Date("2026-04-25T00:00:00.999Z"),
    }
    const once = JSON.stringify(canonicalize(input))
    const twice = JSON.stringify(canonicalize(canonicalize(input)))
    expect(twice).toBe(once)
  })
})

describe("canonicalizeError: rule 6 (name + message, no stack)", () => {
  test("Error with stack -> { __error, name, message }", () => {
    const err = new TypeError("boom")
    expect(canonicalizeError(err)).toEqual({
      __error: true,
      name: "TypeError",
      message: "boom",
    })
  })

  test("two different stacks but same name+message -> equal", () => {
    function failHere() {
      throw new RangeError("range too big")
    }
    function failThere() {
      throw new RangeError("range too big")
    }
    let a: unknown, b: unknown
    try {
      failHere()
    } catch (e) {
      a = canonicalizeError(e)
    }
    try {
      failThere()
    } catch (e) {
      b = canonicalizeError(e)
    }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  test("non-Error value", () => {
    expect(canonicalizeError("plain string")).toEqual({
      __error: true,
      name: "NonError",
      message: "plain string",
    })
  })
})

describe("formatDiff", () => {
  test("identical canonicalized values -> '(no diff)'", () => {
    expect(formatDiff({ a: 1 }, { a: 1 })).toBe("(no diff)")
  })

  test("diff shows first byte mismatch and snippet", () => {
    const a = canonicalize({ status: "open" })
    const b = canonicalize({ status: "closed" })
    const out = formatDiff(a, b)
    expect(out).toContain("byte-position mismatch")
    expect(out).toContain("action snippet")
    expect(out).toContain("handler snippet")
  })
})

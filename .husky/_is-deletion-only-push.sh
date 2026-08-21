# Pre-push deletion-detection helper, sourced by .husky/pre-push.
#
# Per pm/systemdesign.md §6.3 Pre-Push Hook Policy: parses git's pre-push
# stdin (one line per ref, `<local-ref> <local-sha> <remote-ref> <remote-sha>`)
# and exports two flags for the caller's skip clause:
#
#   ALL_DELETIONS = "true" if EVERY spec on stdin had local-sha = 40 zeros,
#                   "false" otherwise
#   ANY_SPECS     = "true" if at least one spec line was read from stdin,
#                   "false" if stdin was empty
#
# The hook's skip clause is then `[ "$ANY_SPECS" = "true" ] && [ "$ALL_DELETIONS" = "true" ]`.
# Empty stdin maps to ANY_SPECS=false → fall through to gates (conservative).
#
# Why a sourced helper rather than inline parse: tests
# (packages/server/src/__tests__/prepush-deletion-skip.test.ts) exercise this
# helper in isolation by sourcing it under bun:test with controlled stdin
# fixtures. The hook itself stays thin per §6.3's "skip clause lives at
# the top of the hook body" anchor.
ALL_DELETIONS=true
ANY_SPECS=false
while IFS=' ' read -r LOCAL_REF LOCAL_SHA REMOTE_REF REMOTE_SHA; do
  ANY_SPECS=true
  if [ "$LOCAL_SHA" != "0000000000000000000000000000000000000000" ]; then
    ALL_DELETIONS=false
  fi
done
export ALL_DELETIONS
export ANY_SPECS

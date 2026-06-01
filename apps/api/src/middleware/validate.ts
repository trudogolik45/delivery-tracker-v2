import type { Context } from 'hono'

// Shared failure hook for `zValidator('json', schema, onValidationError)`.
// Flattens a Zod validation error into the project's standard `{ error: string }`
// body (HTTP 400). @hono/zod-validator's default response is
// `{ success: false, error: <ZodError> }`, which non-API clients (e.g. the admin
// trip wizard) render as "[object Object]". Joining the issue messages keeps a
// single human-readable string, consistent with the `{ error }` shape every
// handler already returns.
//
// Typed structurally (not against a pinned zod version) so it stays assignable
// as a hook regardless of which zod copy a schema was built with, while leaving
// zValidator's own schema inference — and therefore `c.req.valid('json')` — intact.
type ZodValidationResult =
  | { success: true }
  | { success: false; error: { issues: ReadonlyArray<{ message: string }> } }

export function onValidationError(result: ZodValidationResult, c: Context) {
  if (!result.success) {
    const message = result.error.issues.map((issue) => issue.message).join('; ')
    return c.json({ error: message }, 400)
  }
}

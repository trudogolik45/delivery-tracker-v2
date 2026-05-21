import { describe, it, expect } from 'vitest'
import { promises as fs } from 'fs'
import * as path from 'path'

// `apps/api` — two levels up from this file (src/routes/admin.arch.test.ts).
const ROOT = path.resolve(__dirname, '../..')

// Scan only directories that exercise the tenant boundary. We deliberately
// EXCLUDE:
//   - src/db        : the helper itself lives here
//   - src/scripts   : admin tooling not on the request path
//   - src/storage   : no DB access
const SCAN_DIRS = ['src/routes', 'src/middleware', 'src/auth']

// Files explicitly allowed to bypass tenantDb. Empty — the entire forbidden
// surface (share.ts, admin.ts) routes through tenantDb(brand).
const ALLOWLIST = new Set<string>([])

// `.from(brands)` is intentionally NOT forbidden — brands is the tenant
// resolution table itself (Host -> brand lookup, owner-scoped admin listing).
const FORBIDDEN_PATTERN = /\.from\((cargo|trips|uploads)\b/

async function walk(dir: string): Promise<string[]> {
  const out: string[] = []
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      out.push(...(await walk(full)))
    } else if (e.isFile() && full.endsWith('.ts') && !full.endsWith('.test.ts')) {
      out.push(full)
    }
  }
  return out
}

describe('architectural: no raw tenant queries outside the helper', () => {
  it('admin/share/middleware/auth routes use tenantDb instead of db.from(cargo|trips|uploads)', async () => {
    const offenders: { file: string; line: number; text: string }[] = []
    for (const subdir of SCAN_DIRS) {
      const files = await walk(path.join(ROOT, subdir))
      for (const file of files) {
        const rel = path.relative(ROOT, file)
        if (ALLOWLIST.has(rel)) continue
        const content = await fs.readFile(file, 'utf8')
        const lines = content.split('\n')
        lines.forEach((text, i) => {
          if (FORBIDDEN_PATTERN.test(text)) {
            offenders.push({ file: rel, line: i + 1, text: text.trim() })
          }
        })
      }
    }
    expect(
      offenders,
      `raw .from(cargo|trips|uploads) found:\n${offenders
        .map((o) => `  ${o.file}:${o.line}  ${o.text}`)
        .join('\n')}`,
    ).toEqual([])
  })
})

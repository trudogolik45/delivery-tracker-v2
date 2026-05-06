import { parseArgs } from 'node:util'
import { isNull, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { brands, users } from '../db/schema.js'

async function main() {
  const { values } = parseArgs({
    options: {
      'user-id': { type: 'string' },
    },
  })

  const userId = values['user-id']
  if (!userId) {
    console.error('usage: assign-brand-owner --user-id <uuid>')
    process.exit(1)
  }

  const [user] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!user) {
    console.error(`user not found: ${userId}`)
    process.exit(1)
  }

  const updated = await db
    .update(brands)
    .set({ ownerId: userId })
    .where(isNull(brands.ownerId))
    .returning({ id: brands.id, slug: brands.slug })

  console.log(`assigned ${updated.length} brand(s) to ${user.email} (${user.id}):`)
  for (const b of updated) {
    console.log(`  ${b.slug} (${b.id})`)
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => {
    process.exit(0)
  })

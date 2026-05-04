import { parseArgs } from 'node:util'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { users } from '../db/schema.js'
import { hashPassword } from '../auth/passwords.js'

async function main() {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      password: { type: 'string' },
    },
  })

  if (!values.email || !values.password) {
    console.error('usage: seed-admin --email <email> --password <password>')
    process.exit(1)
  }

  const email = values.email.trim().toLowerCase()
  const password = values.password

  if (password.length < 8) {
    console.error('password must be at least 8 characters')
    process.exit(1)
  }

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1)

  if (existing) {
    console.error(`user already exists: ${email}`)
    process.exit(1)
  }

  const passwordHash = await hashPassword(password)
  const [created] = await db
    .insert(users)
    .values({ email, passwordHash })
    .returning({ id: users.id, email: users.email })

  console.log(`created user ${created!.email} (${created!.id})`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => {
    process.exit(0)
  })

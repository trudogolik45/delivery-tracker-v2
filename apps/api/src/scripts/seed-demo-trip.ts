import length from '@turf/length'
import { nanoid } from 'nanoid'
import { eq, asc } from 'drizzle-orm'
import type { Segment } from '@delivery/schemas'
import { db } from '../db/index.js'
import { brands, cargo, trips, users } from '../db/schema.js'

const DEMO_BRAND_SLUG = 'demo'
const DEMO_BRAND_DOMAIN = 'localhost'
const DEMO_BRAND_NAME = 'Demo Carrier'
const DEMO_CARGO_TITLE = 'NYC → Chicago demo cargo'
const SHARE_HASH_LEN = 16
const AVG_SPEED_MS = 88_000 / 3600

const polyline = {
  type: 'LineString' as const,
  coordinates: [
    [-74.006, 40.7128], // NYC
    [-75.1652, 40.4406], // Allentown PA
    [-76.6122, 40.2731], // Harrisburg PA
    [-78.265, 40.4866], // Altoona PA
    [-79.9959, 40.4406], // Pittsburgh
    [-81.6944, 41.4993], // Cleveland
    [-83.5552, 41.6528], // Toledo
    [-85.1394, 41.0793], // Fort Wayne
    [-86.5293, 41.6834], // South Bend
    [-87.6298, 41.8781], // Chicago
  ] as [number, number][],
}

function buildTimeline(startedAt: number, totalDistance: number): Segment[] {
  const segments: Segment[] = []
  let t = startedAt
  let dist = 0
  let chunk: 0 | 1 | 2 | 3 = 0

  while (dist < totalDistance - 1) {
    if (chunk === 0 || chunk === 2) {
      const baseSeconds = chunk === 0 ? 8 * 3600 : 3 * 3600
      const remainingDist = totalDistance - dist
      const drivingSeconds = Math.min(baseSeconds, remainingDist / AVG_SPEED_MS)
      const newDist = Math.min(totalDistance, dist + drivingSeconds * AVG_SPEED_MS)
      segments.push({
        type: 'driving',
        tStart: t,
        tEnd: t + drivingSeconds,
        distStart: dist,
        distEnd: newDist,
      })
      t += drivingSeconds
      dist = newDist
    } else {
      const restSeconds = chunk === 1 ? 30 * 60 : 10 * 3600
      segments.push({
        type: 'rest',
        tStart: t,
        tEnd: t + restSeconds,
        atDist: dist,
        reason: chunk === 1 ? 'break' : 'sleep',
      })
      t += restSeconds
    }
    chunk = ((chunk + 1) % 4) as 0 | 1 | 2 | 3
  }

  return segments
}

async function ensureBrand(ownerId: string) {
  const [existing] = await db.select().from(brands).where(eq(brands.slug, DEMO_BRAND_SLUG)).limit(1)

  if (existing) return existing

  const [created] = await db
    .insert(brands)
    .values({
      slug: DEMO_BRAND_SLUG,
      shareDomain: DEMO_BRAND_DOMAIN,
      name: DEMO_BRAND_NAME,
      ownerId,
    })
    .returning()
  return created!
}

async function ensureCargo(brandId: string) {
  const [existing] = await db.select().from(cargo).where(eq(cargo.brandId, brandId)).limit(1)

  if (existing) return existing

  const [created] = await db.insert(cargo).values({ brandId, title: DEMO_CARGO_TITLE }).returning()
  return created!
}

async function main() {
  const [firstUser] = await db
    .select({ id: users.id })
    .from(users)
    .orderBy(asc(users.createdAt))
    .limit(1)

  if (!firstUser) {
    console.error('no users found — run seed-admin first')
    process.exit(1)
  }

  const brand = await ensureBrand(firstUser.id)
  const demoCargo = await ensureCargo(brand.id)

  const totalDistance =
    length({ type: 'Feature', geometry: polyline, properties: {} }, { units: 'kilometers' }) * 1000

  const startedAt = Math.floor(Date.now() / 1000)
  const timeline = buildTimeline(startedAt, totalDistance)
  const desiredArrival = new Date(timeline[timeline.length - 1]!.tEnd * 1000)

  const shareHash = nanoid(SHARE_HASH_LEN)
  const [trip] = await db
    .insert(trips)
    .values({
      brandId: brand.id,
      cargoId: demoCargo.id,
      shareHash,
      origin: { lat: 40.7128, lng: -74.006, label: 'New York City' },
      destination: { lat: 41.8781, lng: -87.6298, label: 'Chicago' },
      waypoints: [],
      startsAt: new Date(startedAt * 1000),
      desiredArrival,
      routeGeometry: polyline,
      timeline,
    })
    .returning({ id: trips.id, shareHash: trips.shareHash })

  console.log(`created demo trip ${trip!.id}`)
  console.log(`brand: ${brand.name} (slug=${brand.slug}, shareDomain=${brand.shareDomain})`)
  console.log(`distance: ${(totalDistance / 1000).toFixed(0)} km, ${timeline.length} segments`)
  console.log(`share URL: http://localhost:5173/s/${trip!.shareHash}`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => {
    process.exit(0)
  })

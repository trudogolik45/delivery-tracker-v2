import type { TripListItem } from '@delivery/schemas'

export type TripStatus = 'Pending' | 'Driving' | 'Resting' | 'Arrived'

export function tripStatus(item: TripListItem): TripStatus {
  if (!item.timeline || item.startedAt === null) return 'Pending'
  const now = Math.floor(Date.now() / 1000)
  const firstSeg = item.timeline[0]
  const lastSeg = item.timeline[item.timeline.length - 1]
  if (!firstSeg || !lastSeg) return 'Pending'
  if (now < firstSeg.tStart) return 'Pending'
  if (now >= lastSeg.tEnd) return 'Arrived'
  const current = item.timeline.find((s) => s.tStart <= now && now < s.tEnd)
  if (!current) return 'Pending'
  return current.type === 'driving' ? 'Driving' : 'Resting'
}

export function statusBadgeVariant(status: TripStatus): 'default' | 'outline' | 'secondary' {
  if (status === 'Arrived') return 'default'
  if (status === 'Resting') return 'secondary'
  return 'outline'
}

import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Plus, MapPin, Clock } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { apiJson } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { tripStatus, statusBadgeVariant } from '@/lib/trip-status'
import type { TripListItem } from '@delivery/schemas'

export const Route = createFileRoute('/admin/b/$brandSlug/trips/')({
  component: TripsList,
})

function TripsList() {
  const { brandSlug } = Route.useParams()

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', brandSlug, 'trips'],
    queryFn: () => apiJson<TripListItem[]>(`/admin/b/${brandSlug}/trips`),
  })

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading…</div>
  if (error) return <div className="text-sm text-destructive">Failed to load trips.</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Trips</h1>
        <Link
          to="/admin/b/$brandSlug/trips/new"
          params={{ brandSlug }}
          className={buttonVariants({ size: 'sm' })}
        >
          <Plus className="mr-1 h-4 w-4" /> New trip
        </Link>
      </div>

      {!data?.length ? (
        <p className="text-sm text-muted-foreground">No trips yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cargo</TableHead>
              <TableHead>Route</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Starts</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-medium">{t.cargoTitle}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1 text-sm text-muted-foreground">
                    <MapPin className="h-3 w-3" />
                    {(t.origin as { label?: string }).label ?? `${(t.origin as { lat: number }).lat.toFixed(2)},${(t.origin as { lng: number }).lng.toFixed(2)}`}
                    {' → '}
                    {(t.destination as { label?: string }).label ?? `${(t.destination as { lat: number }).lat.toFixed(2)},${(t.destination as { lng: number }).lng.toFixed(2)}`}
                  </div>
                </TableCell>
                <TableCell>
                  <StatusBadge item={t} />
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatDate(t.startsAt)}
                  </div>
                </TableCell>
                <TableCell>
                  <Link
                    to="/admin/b/$brandSlug/trips/$tripId"
                    params={{ brandSlug, tripId: t.id }}
                    className={buttonVariants({ variant: 'outline', size: 'sm' })}
                  >
                    View
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

function StatusBadge({ item }: { item: TripListItem }) {
  const status = tripStatus(item)
  return <Badge variant={statusBadgeVariant(status)}>{status}</Badge>
}

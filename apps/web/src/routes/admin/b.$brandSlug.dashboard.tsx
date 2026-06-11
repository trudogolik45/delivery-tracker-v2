import { useMemo } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Plus, Package, Route as RouteIcon, MapPin } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { apiJson } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { statusBadgeVariant } from '@/lib/trip-status'
import type { CargoWithPhotos, TripListItem } from '@delivery/schemas'

export const Route = createFileRoute('/admin/b/$brandSlug/dashboard')({
  component: BrandDashboard,
})

const PREVIEW_LIMIT = 4

function BrandDashboard() {
  const { brandSlug } = Route.useParams()

  const cargoQuery = useQuery({
    queryKey: ['admin', brandSlug, 'cargo'],
    queryFn: () => apiJson<CargoWithPhotos[]>(`/admin/b/${brandSlug}/cargo`),
  })

  const tripsQuery = useQuery({
    queryKey: ['admin', brandSlug, 'trips'],
    queryFn: () => apiJson<TripListItem[]>(`/admin/b/${brandSlug}/trips`),
  })

  const recentCargo = useMemo(
    () =>
      (cargoQuery.data ?? [])
        .toSorted((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .slice(0, PREVIEW_LIMIT),
    [cargoQuery.data],
  )

  const recentTrips = useMemo(
    () =>
      (tripsQuery.data ?? [])
        .toSorted((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt))
        .slice(0, PREVIEW_LIMIT),
    [tripsQuery.data],
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold capitalize">{brandSlug}</h1>
        <p className="text-sm text-muted-foreground">Brand dashboard</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section
          icon={<Package className="h-4 w-4 text-muted-foreground" />}
          title="Recent cargo"
          isLoading={cargoQuery.isLoading}
          isEmpty={!cargoQuery.isLoading && recentCargo.length === 0}
          emptyText="No cargo yet."
          newAction={
            <Link
              to="/admin/b/$brandSlug/cargo/new"
              params={{ brandSlug }}
              className={buttonVariants({ size: 'sm', variant: 'outline' })}
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> New
            </Link>
          }
          viewAllAction={
            <Link
              to="/admin/b/$brandSlug/cargo"
              params={{ brandSlug }}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              View all →
            </Link>
          }
        >
          {recentCargo.map((c) => (
            <Link
              key={c.id}
              to="/admin/b/$brandSlug/cargo/$cargoId"
              params={{ brandSlug, cargoId: c.id }}
              className="flex items-center gap-3 rounded-md border p-3 transition-colors hover:bg-muted/50"
            >
              {c.photoUrls[0] ? (
                <img
                  src={c.photoUrls[0]}
                  alt=""
                  className="h-10 w-10 shrink-0 rounded object-cover"
                />
              ) : (
                <div className="h-10 w-10 shrink-0 rounded bg-muted" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{c.title}</div>
                <div className="text-xs text-muted-foreground">
                  {formatDate(c.createdAt)} · {c.photoUploadIds.length} photos ·{' '}
                  {Object.keys(c.fields).length} fields
                </div>
              </div>
            </Link>
          ))}
        </Section>

        <Section
          icon={<RouteIcon className="h-4 w-4 text-muted-foreground" />}
          title="Recent trips"
          isLoading={tripsQuery.isLoading}
          isEmpty={!tripsQuery.isLoading && recentTrips.length === 0}
          emptyText="No trips yet."
          newAction={
            <Link
              to="/admin/b/$brandSlug/trips/new"
              params={{ brandSlug }}
              className={buttonVariants({ size: 'sm', variant: 'outline' })}
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> New
            </Link>
          }
          viewAllAction={
            <Link
              to="/admin/b/$brandSlug/trips"
              params={{ brandSlug }}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              View all →
            </Link>
          }
        >
          {recentTrips.map((t) => {
            const origin = (t.origin as { label?: string }).label ?? coordsLabel(t.origin)
            const destination =
              (t.destination as { label?: string }).label ?? coordsLabel(t.destination)
            const status = t.status
            return (
              <Link
                key={t.id}
                to="/admin/b/$brandSlug/trips/$tripId"
                params={{ brandSlug, tripId: t.id }}
                className="flex items-start gap-3 rounded-md border p-3 transition-colors hover:bg-muted/50"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{t.cargoTitle}</span>
                    <Badge variant={statusBadgeVariant(status)} className="shrink-0">
                      {status}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3 shrink-0" />
                    <span className="truncate">
                      {origin} → {destination}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">{formatDate(t.startsAt)}</div>
                </div>
              </Link>
            )
          })}
        </Section>
      </div>
    </div>
  )
}

function Section({
  icon,
  title,
  isLoading,
  isEmpty,
  emptyText,
  newAction,
  viewAllAction,
  children,
}: {
  icon: React.ReactNode
  title: string
  isLoading: boolean
  isEmpty: boolean
  emptyText: string
  newAction: React.ReactNode
  viewAllAction: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="font-semibold">{title}</h2>
        </div>
        {newAction}
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : isEmpty ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <div className="space-y-2">{children}</div>
      )}
      <div className="flex justify-end">{viewAllAction}</div>
    </section>
  )
}

function coordsLabel(point: unknown): string {
  const p = point as { lat: number; lng: number }
  return `${p.lat.toFixed(2)},${p.lng.toFixed(2)}`
}

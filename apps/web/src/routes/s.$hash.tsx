import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ShareResponseSchema, type ShareResponse } from '@delivery/schemas'
import { apiRequest } from '@/lib/api'
import { formatDateTime, formatMiles } from '@/lib/format'
import { TripMap } from '@/components/TripMap'
import { Badge } from '@/components/ui/badge'

export const Route = createFileRoute('/s/$hash')({
  component: SharePage,
})

const REDIRECTING = Symbol('redirecting')
type ShareResult = ShareResponse | typeof REDIRECTING

function SharePage() {
  const { hash } = Route.useParams()

  const { data, isLoading, error } = useQuery<ShareResult>({
    queryKey: ['share', hash],
    queryFn: async () => {
      const res = await apiRequest(`/share/${hash}`)
      if (res.status === 421) {
        const body = (await res.json()) as { redirectTo?: string }
        if (body.redirectTo) {
          window.location.replace(body.redirectTo)
          return REDIRECTING
        }
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return ShareResponseSchema.parse(await res.json())
    },
    staleTime: 25_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    retry: false,
  })

  if (isLoading || data === REDIRECTING) {
    return <div className="p-8 text-sm text-muted-foreground">Loading…</div>
  }
  if (error || !data) {
    return <div className="p-8 text-sm text-destructive">Trip not found.</div>
  }

  const fieldEntries = Object.entries(data.cargo.fields)
  const lastSeg = data.trip.segments[data.trip.segments.length - 1]!
  const eta = new Date(lastSeg.tEnd * 1000)
  const lastPause = data.trip.pauses.at(-1)
  const nowSec = Date.now() / 1000
  const isPaused =
    lastPause !== undefined && (lastPause.resumedAt === undefined || lastPause.resumedAt > nowSec)

  return (
    <div className="flex h-screen flex-col md:flex-row">
      <aside className="border-b md:border-b-0 md:border-r md:w-1/3 md:max-w-md md:overflow-y-auto">
        <div className="p-6 space-y-5">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Tracking</p>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold">{data.cargo.title}</h1>
              {isPaused && <Badge variant="secondary">Service stop</Badge>}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              ETA {formatDateTime(eta)} · {formatMiles(data.trip.totalDistance)} total
            </p>
          </div>

          {data.cargo.photoUrls.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {data.cargo.photoUrls.map((url, i) => (
                <a
                  key={i}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="aspect-square overflow-hidden rounded border"
                >
                  <img src={url} alt="" className="h-full w-full object-cover" />
                </a>
              ))}
            </div>
          )}

          {fieldEntries.length > 0 && (
            <dl className="space-y-2 text-sm">
              {fieldEntries.map(([key, value]) => (
                <div key={key} className="flex flex-col">
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">{key}</dt>
                  <dd className="font-medium break-words">{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </aside>
      <div className="flex-1 min-h-[60vh] md:min-h-0">
        <TripMap trip={data.trip} showFooter className="h-full" />
      </div>
    </div>
  )
}

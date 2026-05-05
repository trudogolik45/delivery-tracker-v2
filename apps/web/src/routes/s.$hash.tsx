import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ShareResponseSchema, type ShareResponse } from '@delivery/schemas'
import { apiRequest } from '@/lib/api'
import { TripMap } from '@/components/TripMap'

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
    staleTime: 60_000,
    retry: false,
  })

  if (isLoading || data === REDIRECTING) {
    return <div className="p-8 text-sm text-muted-foreground">Loading…</div>
  }
  if (error || !data) {
    return <div className="p-8 text-sm text-destructive">Trip not found.</div>
  }

  return (
    <div className="flex h-screen flex-col">
      <TripMap trip={data.trip} cargoTitle={data.cargo.title} className="flex-1" />
    </div>
  )
}

import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ShareResponseSchema } from '@delivery/schemas'
import { apiJson } from '@/lib/api'
import { TripMap } from '@/components/TripMap'

export const Route = createFileRoute('/s/$hash')({
  component: SharePage,
})

function SharePage() {
  const { hash } = Route.useParams()

  const { data, isLoading, error } = useQuery({
    queryKey: ['share', hash],
    queryFn: () => apiJson(`/share/${hash}`, {}, (raw) => ShareResponseSchema.parse(raw)),
    staleTime: 60_000,
  })

  if (isLoading) {
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

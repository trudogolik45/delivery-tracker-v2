import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { BrandsArraySchema } from '@delivery/schemas'
import { apiJson } from '@/lib/api'

export const Route = createFileRoute('/admin/')({
  component: AdminIndex,
})

function AdminIndex() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'brands'],
    queryFn: () => apiJson('/admin/brands', {}, (raw) => BrandsArraySchema.parse(raw)),
  })

  if (isLoading) return <div>Loading…</div>
  if (error) return <div className="text-destructive">Error: {String(error)}</div>
  if (!data || data.length === 0) {
    return (
      <div className="text-muted-foreground">
        No brands yet. Add one via psql to see it here.
      </div>
    )
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {data.map((brand) => (
        <Link
          key={brand.id}
          to="/admin/b/$brandSlug/dashboard"
          params={{ brandSlug: brand.slug }}
          className="rounded-lg border bg-card p-4 shadow-sm transition hover:shadow-md"
        >
          <div className="text-lg font-semibold">{brand.name}</div>
          <div className="text-sm text-muted-foreground">{brand.slug}</div>
        </Link>
      ))}
    </div>
  )
}

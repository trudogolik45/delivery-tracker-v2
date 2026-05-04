import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/b/$brandSlug/dashboard')({
  component: BrandDashboard,
})

function BrandDashboard() {
  const { brandSlug } = Route.useParams()
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-bold">{brandSlug}</h1>
      <p className="text-sm text-muted-foreground">Dashboard placeholder for brand {brandSlug}.</p>
    </div>
  )
}

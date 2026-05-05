import { createFileRoute, Link } from '@tanstack/react-router'
import { Package, Route as RouteIcon } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

export const Route = createFileRoute('/admin/b/$brandSlug/dashboard')({
  component: BrandDashboard,
})

function BrandDashboard() {
  const { brandSlug } = Route.useParams()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold capitalize">{brandSlug}</h1>
        <p className="text-sm text-muted-foreground">Brand dashboard</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="p-6 space-y-3">
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5 text-muted-foreground" />
            <h2 className="font-semibold">Cargo</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Manage cargo items and their photos.
          </p>
          <Link
            to="/admin/b/$brandSlug/cargo"
            params={{ brandSlug }}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            View cargo
          </Link>
        </Card>

        <Card className="p-6 space-y-3">
          <div className="flex items-center gap-2">
            <RouteIcon className="h-5 w-5 text-muted-foreground" />
            <h2 className="font-semibold">Trips</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Create and track delivery trips.
          </p>
          <Link
            to="/admin/b/$brandSlug/trips"
            params={{ brandSlug }}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            View trips
          </Link>
        </Card>
      </div>
    </div>
  )
}

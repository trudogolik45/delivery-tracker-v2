import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/b/$brandSlug/trips')({
  component: TripsLayout,
})

function TripsLayout() {
  return <Outlet />
}

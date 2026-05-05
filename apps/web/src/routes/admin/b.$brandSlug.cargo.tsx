import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/b/$brandSlug/cargo')({
  component: CargoLayout,
})

function CargoLayout() {
  return <Outlet />
}

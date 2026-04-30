import { createRootRoute, Link, Outlet } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'

export const Route = createRootRoute({
  component: () => (
    <>
      <nav className="p-4 flex gap-4 border-b">
        <Link to="/" className="[&.active]:font-bold">Home</Link>
        <Link to="/admin" className="[&.active]:font-bold">Admin</Link>
      </nav>
      <Outlet />
      <TanStackRouterDevtools />
    </>
  ),
})

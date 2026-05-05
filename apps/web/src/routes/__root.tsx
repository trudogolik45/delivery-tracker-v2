import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Link, Outlet, useLocation } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'

function RootLayout() {
  const { pathname } = useLocation()
  const isSharePage = pathname.startsWith('/s/')

  return (
    <>
      {!isSharePage && (
        <nav className="p-4 flex gap-4 border-b">
          <Link to="/" className="[&.active]:font-bold">Home</Link>
          <Link to="/admin" className="[&.active]:font-bold">Admin</Link>
        </nav>
      )}
      <Outlet />
      <TanStackRouterDevtools />
    </>
  )
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
})

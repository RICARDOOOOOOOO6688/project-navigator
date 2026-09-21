import { createFileRoute, Outlet } from "@tanstack/react-router";

// Layout route for /chat/* — children render via <Outlet />.
export const Route = createFileRoute("/_authenticated/chat")({
  component: () => <Outlet />,
});

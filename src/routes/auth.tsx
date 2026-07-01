import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "VertX Field" }] }),
  component: () => <Navigate to="/" replace />,
});
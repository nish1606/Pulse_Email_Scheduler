import { type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { loading, authenticated } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white text-ong-muted">
        Loading...
      </div>
    );
  }
  if (!authenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

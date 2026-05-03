import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";

import { getDashboardPathForUser, getStoredCurrentUser, getUserRole, type AuthRole } from "../lib/auth";

export function PublicOnlyRoute({ children }: { children: ReactNode }) {
  const currentUser = getStoredCurrentUser();

  if (currentUser) {
    return <Navigate to={getDashboardPathForUser(currentUser)} replace />;
  }

  return <>{children}</>;
}

export function ProtectedRoute({
  children,
  allowedRoles,
}: {
  children: ReactNode;
  allowedRoles?: AuthRole[];
}) {
  const location = useLocation();
  const currentUser = getStoredCurrentUser();

  if (!currentUser) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  const role = getUserRole(currentUser);
  if (allowedRoles?.length && (!role || !allowedRoles.includes(role))) {
    return <Navigate to={getDashboardPathForUser(currentUser)} replace />;
  }

  return <>{children}</>;
}

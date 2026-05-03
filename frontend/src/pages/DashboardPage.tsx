import { Navigate } from "react-router-dom";

import { getDashboardPathForUser, getStoredCurrentUser } from "../lib/auth";

export function DashboardRedirectPage() {
  const currentUser = getStoredCurrentUser();

  if (!currentUser) {
    return <Navigate to="/login" replace />;
  }

  return <Navigate to={getDashboardPathForUser(currentUser)} replace />;
}

export function AdminDashboardPage() {
  const currentUser = getStoredCurrentUser();
  return <Navigate to={getDashboardPathForUser(currentUser)} replace />;
}

export function PatientDashboardPage() {
  const currentUser = getStoredCurrentUser();
  return <Navigate to={getDashboardPathForUser(currentUser)} replace />;
}

export function PharmacyDashboardPage() {
  const currentUser = getStoredCurrentUser();
  return <Navigate to={getDashboardPathForUser(currentUser)} replace />;
}

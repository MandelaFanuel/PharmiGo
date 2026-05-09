import { type ReactNode } from "react";
import { Route, Routes, useLocation } from "react-router-dom";

import AnimatedPage from "./components/AnimatedPage";
import { ProtectedRoute, PublicOnlyRoute } from "./components/RouteGuards";
import Footer from "./components/Footer";
import Header from "./components/Header";
import LocationPermissionPrompt from "./components/LocationPermissionPrompt";
import PWAInstallPrompt from "./components/PWAInstallPrompt";
import AuthPage from "./pages/AuthPage";
import Chat from "./pages/Chat";
import { AdminDashboardPage, DashboardRedirectPage, PatientDashboardPage, PharmacyDashboardPage } from "./pages/DashboardPage";
import Home from "./pages/Home";
import Operations from "./pages/Operations";
import PharmacyDetail from "./pages/PharmacyDetail";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Search from "./pages/Search";
import UploadPrescription from "./pages/UploadPrescription";
import VerifyEmail from "./pages/VerifyEmail";
function withPageTransition(element: ReactNode) {
  return <AnimatedPage>{element}</AnimatedPage>;
}

export default function App() {
  const location = useLocation();
  const isHomePage = location.pathname === "/";
  const isDashboardRoute = location.pathname.startsWith("/dashboard");
  const isAuthRoute =
    location.pathname === "/login" ||
    location.pathname === "/register" ||
    location.pathname === "/forgot-password" ||
    location.pathname === "/reset-password" ||
    location.pathname === "/verify-email";
  const showChrome = !isHomePage && !isDashboardRoute && !isAuthRoute;

  return (
    <div className="app-shell">
      <PWAInstallPrompt />
      <LocationPermissionPrompt key={`${location.pathname}${location.search}`} />
      {showChrome ? <Header /> : null}
      <main
        className={
          isHomePage
            ? "page-shell home-shell"
            : isDashboardRoute
              ? "page-shell dashboard-route-shell"
              : isAuthRoute
                ? "page-shell auth-route-shell"
                : "page-shell"
        }
        >
        <Routes>
          <Route path="/" element={withPageTransition(<Home />)} />
          <Route
            path="/login"
            element={
              <PublicOnlyRoute>
                <AnimatedPage>
                  <AuthPage />
                </AnimatedPage>
              </PublicOnlyRoute>
            }
          />
          <Route
            path="/register"
            element={
              <PublicOnlyRoute>
                <AnimatedPage>
                  <AuthPage />
                </AnimatedPage>
              </PublicOnlyRoute>
            }
          />
          <Route
            path="/forgot-password"
            element={
              <PublicOnlyRoute>
                <AnimatedPage>
                  <ForgotPassword />
                </AnimatedPage>
              </PublicOnlyRoute>
            }
          />
          <Route
            path="/reset-password"
            element={
              <PublicOnlyRoute>
                <AnimatedPage>
                  <ResetPassword />
                </AnimatedPage>
              </PublicOnlyRoute>
            }
          />
          <Route path="/verify-email" element={withPageTransition(<VerifyEmail />)} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <AnimatedPage>
                  <DashboardRedirectPage />
                </AnimatedPage>
              </ProtectedRoute>
            }
          />
          <Route
            path="/dashboard/admin"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AnimatedPage>
                  <AdminDashboardPage />
                </AnimatedPage>
              </ProtectedRoute>
            }
          />
          <Route
            path="/dashboard/patient"
            element={
              <ProtectedRoute allowedRoles={["patient"]}>
                <AnimatedPage>
                  <PatientDashboardPage />
                </AnimatedPage>
              </ProtectedRoute>
            }
          />
          <Route
            path="/dashboard/pharmacy"
            element={
              <ProtectedRoute allowedRoles={["pharmacy"]}>
                <AnimatedPage>
                  <PharmacyDashboardPage />
                </AnimatedPage>
              </ProtectedRoute>
            }
          />
          <Route path="/search" element={withPageTransition(<Search />)} />
          <Route path="/pharmacy/:id" element={withPageTransition(<PharmacyDetail />)} />
          <Route path="/upload-prescription" element={withPageTransition(<UploadPrescription />)} />
          <Route path="/chat" element={withPageTransition(<Chat />)} />
          <Route path="/operations" element={withPageTransition(<Operations />)} />
        </Routes>
      </main>
      {showChrome ? <Footer /> : null}
    </div>
  );
}

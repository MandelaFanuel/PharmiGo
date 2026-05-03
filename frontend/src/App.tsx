import { Route, Routes, useLocation } from "react-router-dom";

import { ProtectedRoute, PublicOnlyRoute } from "./components/RouteGuards";
import Footer from "./components/Footer";
import Header from "./components/Header";
import PWAInstallPrompt from "./components/PWAInstallPrompt";
import Chat from "./pages/Chat";
import { AdminDashboardPage, DashboardRedirectPage, PatientDashboardPage, PharmacyDashboardPage } from "./pages/DashboardPage";
import Home from "./pages/Home";
import Login from "./pages/Login";
import Operations from "./pages/Operations";
import PharmacyDetail from "./pages/PharmacyDetail";
import ForgotPassword from "./pages/ForgotPassword";
import Register from "./pages/Register";
import ResetPassword from "./pages/ResetPassword";
import Search from "./pages/Search";
import UploadPrescription from "./pages/UploadPrescription";

export default function App() {
  const location = useLocation();
  const isHomePage = location.pathname === "/";
  const isDashboardRoute = location.pathname.startsWith("/dashboard");
  const showChrome = !isHomePage && !isDashboardRoute;

  return (
    <div className="app-shell">
      <PWAInstallPrompt />
      {showChrome ? <Header /> : null}
      <main className={isHomePage ? "page-shell home-shell" : isDashboardRoute ? "page-shell dashboard-route-shell" : "page-shell"}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route
            path="/login"
            element={
              <PublicOnlyRoute>
                <Login />
              </PublicOnlyRoute>
            }
          />
          <Route
            path="/register"
            element={
              <PublicOnlyRoute>
                <Register />
              </PublicOnlyRoute>
            }
          />
          <Route
            path="/forgot-password"
            element={
              <PublicOnlyRoute>
                <ForgotPassword />
              </PublicOnlyRoute>
            }
          />
          <Route
            path="/reset-password"
            element={
              <PublicOnlyRoute>
                <ResetPassword />
              </PublicOnlyRoute>
            }
          />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <DashboardRedirectPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/dashboard/admin"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminDashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/dashboard/patient"
            element={
              <ProtectedRoute allowedRoles={["patient"]}>
                <PatientDashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/dashboard/pharmacy"
            element={
              <ProtectedRoute allowedRoles={["pharmacy"]}>
                <PharmacyDashboardPage />
              </ProtectedRoute>
            }
          />
          <Route path="/search" element={<Search />} />
          <Route path="/pharmacy/:id" element={<PharmacyDetail />} />
          <Route path="/upload-prescription" element={<UploadPrescription />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/operations" element={<Operations />} />
        </Routes>
      </main>
      {showChrome ? <Footer /> : null}
    </div>
  );
}

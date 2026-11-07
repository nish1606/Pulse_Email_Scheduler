import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./hooks/useAuth";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { DashboardLayout } from "./layouts/DashboardLayout";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ScheduledPage } from "./pages/ScheduledPage";
import { SentPage } from "./pages/SentPage";
import { ComposePage } from "./pages/ComposePage";
import { EmailDetailPage } from "./pages/EmailDetailPage";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <DashboardLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="scheduled" element={<ScheduledPage />} />
            <Route path="sent" element={<SentPage />} />
            <Route path="compose" element={<ComposePage />} />
            <Route path="email/:id" element={<EmailDetailPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/scheduled" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { LastVisitedRedirect } from "./components/LastVisitedRedirect";
import { LoginPage } from "./pages/LoginPage";
import { HomePage } from "./pages/HomePage";
import { ShiftsPage } from "./pages/ShiftsPage";
import { PaymentPage } from "./pages/PaymentPage";
import { ModelWorkspacePage } from "./pages/ModelWorkspacePage";
import { ConfigPage } from "./pages/ConfigPage";
import { ManagerChattersPage } from "./pages/ManagerChattersPage";
import { ManagerChatterDetailPage } from "./pages/ManagerChatterDetailPage";
import { ManagerPaymentsWorkflowPage } from "./pages/ManagerPaymentsWorkflowPage";
import { MphRankingPage } from "./pages/MphRankingPage";
import { ManagerAuditPage } from "./pages/ManagerAuditPage";

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route path="/home" element={<ProtectedRoute roles={["MANAGER"]}><HomePage /></ProtectedRoute>} />
        <Route path="/horarios" element={<ShiftsPage />} />
        <Route path="/pagamento" element={<PaymentPage />} />
        <Route path="/central-modelo" element={<ModelWorkspacePage />} />
        <Route path="/chat" element={<Navigate to="/central-modelo?tab=chat" replace />} />
        <Route path="/funcionario-do-mes" element={<MphRankingPage />} />
        <Route path="/config" element={<ConfigPage />} />
        <Route
          path="/chatters"
          element={
            <ProtectedRoute roles={["MANAGER"]}>
              <ManagerChattersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/chatters/:chatterId"
          element={
            <ProtectedRoute roles={["MANAGER"]}>
              <ManagerChatterDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/tags"
          element={<Navigate to="/chatters?section=tags" replace />}
        />
        <Route
          path="/pagamentos"
          element={
            <ProtectedRoute roles={["MANAGER"]}>
              <ManagerPaymentsWorkflowPage />
            </ProtectedRoute>
          }
        />
        <Route path="/auditoria" element={<ProtectedRoute roles={["MANAGER"]}><ManagerAuditPage /></ProtectedRoute>} />
      </Route>

      <Route path="*" element={<LastVisitedRedirect />} />
    </Routes>
  );
}

export default App;

import { lazy, Suspense, type ComponentType } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { ProtectedRoute } from "./components/ProtectedRoute";

const page = <T extends Record<string, unknown>>(loader: () => Promise<T>, name: keyof T) => lazy(async () => {
  const module = await loader();
  return { default: module[name] as ComponentType };
});

const LoginPage = page(() => import("./pages/LoginPage"), "LoginPage");
const HomePage = page(() => import("./pages/HomePage"), "HomePage");
const ShiftsPage = page(() => import("./pages/ShiftsPage"), "ShiftsPage");
const PaymentPage = page(() => import("./pages/PaymentPage"), "PaymentPage");
const ChatPage = page(() => import("./pages/ChatPage"), "ChatPage");
const ConfigPage = page(() => import("./pages/ConfigPage"), "ConfigPage");
const ManagerChattersPage = page(() => import("./pages/ManagerChattersPage"), "ManagerChattersPage");
const ManagerChatterDetailPage = page(() => import("./pages/ManagerChatterDetailPage"), "ManagerChatterDetailPage");
const ManagerPaymentsPage = page(() => import("./pages/ManagerPaymentsPage"), "ManagerPaymentsPage");
const MphRankingPage = page(() => import("./pages/MphRankingPage"), "MphRankingPage");
const ManagerAuditPage = page(() => import("./pages/ManagerAuditPage"), "ManagerAuditPage");

function App() {
  return (
    <Suspense fallback={<div className="route-skeleton" role="status" aria-label="Carregando página"><span /><span /><span /></div>}>
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route path="/home" element={<HomePage />} />
        <Route path="/horarios" element={<ShiftsPage />} />
        <Route path="/pagamento" element={<PaymentPage />} />
        <Route path="/chat" element={<ChatPage />} />
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
              <ManagerPaymentsPage />
            </ProtectedRoute>
          }
        />
        <Route path="/auditoria" element={<ProtectedRoute roles={["MANAGER"]}><ManagerAuditPage /></ProtectedRoute>} />
      </Route>

      <Route path="*" element={<Navigate to="/home" replace />} />
    </Routes>
    </Suspense>
  );
}

export default App;

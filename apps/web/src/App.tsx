import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { LoginPage } from "./pages/LoginPage";
import { HomePage } from "./pages/HomePage";
import { PaymentPage } from "./pages/PaymentPage";
import { ChatPage } from "./pages/ChatPage";
import { ConfigPage } from "./pages/ConfigPage";
import { ManagerChattersPage } from "./pages/ManagerChattersPage";
import { ManagerTagsPage } from "./pages/ManagerTagsPage";

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
        <Route path="/home" element={<HomePage />} />
        <Route path="/pagamento" element={<PaymentPage />} />
        <Route path="/chat" element={<ChatPage />} />
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
          path="/tags"
          element={
            <ProtectedRoute roles={["MANAGER"]}>
              <ManagerTagsPage />
            </ProtectedRoute>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/home" replace />} />
    </Routes>
  );
}

export default App;

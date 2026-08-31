import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../lib/api";
import { useTheme } from "../components/ThemeContext";
import { useToast } from "../components/Toast";
import { getApiErrorMessage } from "../lib/apiError";
import { useAuth } from "../auth/AuthContext";
import { playNotificationSound, showBrowserNotification } from "../lib/shiftNotifications";

export const ConfigPage = () => {
  const { theme, toggleTheme } = useTheme();
  const toast = useToast();
  const { user, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [reminderInterval, setReminderInterval] = useState<15 | 30 | 45 | 60>(user?.shiftReminderIntervalMinutes ?? 60);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(typeof Notification === "undefined" ? "denied" : Notification.permission);

  useEffect(() => {
    if (user?.role !== "CHATTER") return;
    void api.get("/notifications/preferences").then((response) => setReminderInterval(response.data.preferences.shiftReminderIntervalMinutes));
  }, [user?.role]);

  const saveReminderInterval = async (value: 15 | 30 | 45 | 60) => {
    setReminderInterval(value);
    try { await api.patch("/notifications/preferences", { shiftReminderIntervalMinutes: value }); toast.success("Intervalo dos lembretes salvo."); }
    catch (error) { toast.error(getApiErrorMessage(error, "Não foi possível salvar o intervalo.")); }
  };
  const enableNotifications = async () => {
    if (!("Notification" in window)) { toast.error("Este navegador não oferece notificações do sistema."); return; }
    const permission = await Notification.requestPermission(); setNotificationPermission(permission);
    if (permission === "granted") { toast.success("Notificações do sistema ativadas. Você já pode abrir o ponto."); }
    else toast.info("A permissão não foi concedida. Os avisos ainda aparecerão dentro do site.");
  };
  const testNotifications = () => {
    if (notificationPermission !== "granted") {
      toast.error("Ative as notificações do navegador antes de fazer o teste.");
      return;
    }
    const title = "Teste de notificação";
    const message = "Tudo certo: você receberá avisos enquanto seu ponto estiver aberto.";
    toast.info(`${title}: ${message}`);
    void playNotificationSound();
    showBrowserNotification({ id: `notification-test-${Date.now()}`, title, message });
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();

    try {
      await api.post("/auth/change-password", {
        currentPassword,
        newPassword
      });

      toast.success("Senha alterada. Faça login novamente.");
      setCurrentPassword("");
      setNewPassword("");
      await logout();
    } catch (requestError: unknown) {
      const feedback = getApiErrorMessage(requestError, "Não foi possível alterar a senha.");
      toast.error(feedback);
    }
  };

  return (
    <section className="stack-gap">
      <div className="page-header">
        <div>
          <h1>Configurações</h1>
          <p>Ajuste suas preferências</p>
        </div>
      </div>

      <div className="card form-grid">
        <h2>Configuracoes da conta</h2>
        {user?.mustChangePassword ? <div className="warning-box" role="alert">Por segurança, substitua a senha temporária antes de continuar.</div> : null}

        <form className="form-grid" onSubmit={onSubmit}>
          <label>
            Senha atual
            <input
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
            />
          </label>

          <label>
            Nova senha
            <input
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              required
            />
          </label>

          <button className="primary-button" type="submit">
            Alterar senha
          </button>
        </form>

      </div>

      <div className="card">
        <h2>Aparencia</h2>
        <div className="theme-toggle-row">
          <span>Tema {theme === "dark" ? "escuro" : "claro"}</span>
          <button type="button" className="secondary-button" onClick={toggleTheme}>
            {theme === "dark" ? "Usar tema claro" : "Usar tema escuro"}
          </button>
        </div>
      </div>

      {user?.role === "CHATTER" ? <div className="card form-grid notification-settings">
        <h2>Lembretes de ponto</h2><p>Enquanto o site estiver aberto e seu ponto estiver em andamento, você receberá avisos no sistema e dentro do app.</p>
        <label>Intervalo<select value={reminderInterval} onChange={(event) => void saveReminderInterval(Number(event.target.value) as 15 | 30 | 45 | 60)}><option value={15}>A cada 15 minutos</option><option value={30}>A cada 30 minutos</option><option value={45}>A cada 45 minutos</option><option value={60}>A cada 60 minutos</option></select></label>
        <div className="theme-toggle-row"><span>Notificações do navegador: <strong>{notificationPermission === "granted" ? "ativadas" : notificationPermission === "denied" ? "bloqueadas" : "aguardando permissão"}</strong></span><div className="actions-cell"><button className="secondary-button" type="button" onClick={() => void testNotifications()} disabled={notificationPermission !== "granted"}>Testar notificação</button><button className="primary-button" type="button" onClick={() => void enableNotifications()} disabled={notificationPermission === "granted"}>{notificationPermission === "granted" ? "Ativadas" : "Ativar notificações"}</button></div></div>
        <small className="field-hint">Os avisos críticos de 23:55, 23:57 e 23:59 são sempre enviados, independentemente do intervalo.</small>
      </div> : null}
    </section>
  );
};

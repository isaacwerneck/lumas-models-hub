import { useState } from "react";
import type { FormEvent } from "react";
import { api } from "../lib/api";
import { useTheme } from "../components/ThemeContext";
import { useToast } from "../components/Toast";
import { getApiErrorMessage } from "../lib/apiError";
import { useAuth } from "../auth/AuthContext";

export const ConfigPage = () => {
  const { theme, toggleTheme } = useTheme();
  const toast = useToast();
  const { user, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

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
      const feedback = getApiErrorMessage(requestError, "Nao foi possivel alterar a senha.");
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
    </section>
  );
};

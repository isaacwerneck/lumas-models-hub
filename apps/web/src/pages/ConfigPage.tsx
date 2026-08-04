import { useState } from "react";
import type { FormEvent } from "react";
import { api } from "../lib/api";

export const ConfigPage = () => {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setMessage(null);

    try {
      await api.post("/auth/change-password", {
        currentPassword,
        newPassword
      });

      setMessage("Senha alterada. Faça login novamente.");
      setCurrentPassword("");
      setNewPassword("");
    } catch (requestError: any) {
      setError(requestError?.response?.data?.message ?? "Nao foi possivel alterar a senha.");
    }
  };

  return (
    <section className="card form-grid">
      <h2>Configuracoes da conta</h2>

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

      {message ? <div className="success-box">{message}</div> : null}
      {error ? <div className="error-box">{error}</div> : null}
    </section>
  );
};

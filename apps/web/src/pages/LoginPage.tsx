import { useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { DotartSide } from "../components/DotartSide";

export const LoginPage = () => {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (user) {
    return <Navigate to="/home" replace />;
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await login(username, password);
      navigate("/home", { replace: true });
    } catch {
      setError("Credenciais inválidas.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-screen">
      <DotartSide className="login-ornament left" />

      <form className="login-card" onSubmit={onSubmit}>
        <div className="login-logo-wrap">
          <img src="/assets/logo.png" alt="LumasModels" className="login-logo" />
        </div>

        <div className="login-fields">
          <label>
            Login
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Nome"
              required
            />
          </label>

          <label>
            Senha
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Senha"
              required
            />
            <small className="muted">Esqueci a senha</small>
          </label>

          {error ? <div className="error-box">{error}</div> : null}

          <button className="primary-button login-submit" type="submit" disabled={loading}>
            {loading ? "Entrando..." : "Entrar"}
          </button>
        </div>
      </form>

      <DotartSide className="login-ornament right" />
    </div>
  );
};

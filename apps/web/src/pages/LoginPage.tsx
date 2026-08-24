import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { SessionStatusScreen } from "../components/SessionStatusScreen";
import { getLastVisitedRoute } from "../lib/lastVisitedRoute";

export const LoginPage = () => {
  const { user, status, login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [flowerArt, setFlowerArt] = useState("");

  useEffect(() => {
    if (sessionStorage.getItem("lumas_session_expired") === "1") {
      sessionStorage.removeItem("lumas_session_expired");
      setError("Sua sessão expirou. Entre novamente.");
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/assets/flower.txt");
        if (!response.ok) {
          throw new Error("flower not found");
        }
        const text = await response.text();
        setFlowerArt(text);
      } catch {
        setFlowerArt("");
      }
    })();
  }, []);

  if (status === "restoring" || status === "unavailable") {
    return <SessionStatusScreen />;
  }

  if (status === "authenticated" && user) {
    return <Navigate to={getLastVisitedRoute(user)} replace />;
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const authenticatedUser = await login(username.trim().toLowerCase(), password);
      navigate(getLastVisitedRoute(authenticatedUser), { replace: true });
    } catch {
      setError("Credenciais inválidas.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="bg-atmosphere" aria-hidden="true">
        <div className="bg-aurora" />
        <div className="bg-particle p1" />
        <div className="bg-particle p2" />
        <div className="bg-particle p3" />
        <div className="bg-particle p4" />
      </div>

      <form className="login-card" onSubmit={onSubmit}>
        <div className="login-logo-wrap">
          <img src="/assets/logo.svg" alt="LumasModels" className="login-logo" />
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
          </label>

          {error ? <div className="error-box">{error}</div> : null}
        </div>

        <button className="primary-button login-submit" type="submit" disabled={loading}>
          {loading ? "Entrando..." : "Entrar"}
        </button>
      </form>

      <div className="login-flower-area" aria-hidden="true">
        {flowerArt && flowerArt.trim().length > 0 ? (
          <pre className="flower-art">{flowerArt}</pre>
        ) : null}
      </div>
    </div>
  );
};

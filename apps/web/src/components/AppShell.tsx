import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useEffect, useState } from "react";

export const AppShell = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [dotArt, setDotArt] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/assets/dotarts.txt");
        const text = await response.text();
        setDotArt(text.split("\n").slice(0, 42).join("\n"));
      } catch {
        setDotArt("");
      }
    })();
  }, []);

  const onLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <nav className="menu">
          <NavLink to="/home" className="menu-link">
            Horarios
          </NavLink>
          <NavLink to="/chat" className="menu-link">
            Chat
          </NavLink>
          <NavLink to="/pagamento" className="menu-link">
            Pagamento
          </NavLink>
          <NavLink to="/config" className="menu-link">
            Config
          </NavLink>
          {user?.role === "MANAGER" ? (
            <>
              <NavLink to="/chatters" className="menu-link">
                Chatters
              </NavLink>
              <NavLink to="/tags" className="menu-link">
                Tags
              </NavLink>
            </>
          ) : null}
        </nav>

        <button className="secondary-button" type="button" onClick={onLogout}>
          Sair
        </button>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="brand-zone">
            <img src="/assets/logo.png" alt="LumasModels Hub" className="brand-logo" />
            <div>
              <h1 className="brand-title">LumasModels Hub</h1>
              <p className="brand-subtitle">
                {user?.displayName} ({user?.role === "MANAGER" ? "Gerente" : "Chatter"})
              </p>
            </div>
          </div>
        </header>

        <section className="content-grid">
          <div className="content-area">
            <Outlet />
          </div>
          <div className="dotart-card">
            <h3>DotArt</h3>
            <pre>{dotArt}</pre>
          </div>
        </section>
      </main>
    </div>
  );
};

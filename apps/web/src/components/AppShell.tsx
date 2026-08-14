import { NavLink, Outlet } from "react-router-dom";
import { DotartSide } from "./DotartSide";

export const AppShell = () => {
  return (
    <div className="app-stage">
      <DotartSide className="app-ornament left" />

      <main className="app-shell">
        <header className="hub-nav-wrap">
          <nav className="hub-nav" aria-label="Navegacao principal">
            <div className="hub-nav-group">
              <NavLink to="/home" className="menu-link">
                Horarios
              </NavLink>
              <NavLink to="/chat" className="menu-link">
                Chat
              </NavLink>
            </div>

            <div className="hub-brand-center">
              <img src="/assets/logo.png" alt="LumasModels Hub" className="hub-brand-logo" />
            </div>

            <div className="hub-nav-group">
              <NavLink to="/pagamento" className="menu-link">
                Pagamento
              </NavLink>
              <NavLink to="/config" className="menu-link">
                Config
              </NavLink>
            </div>
          </nav>
        </header>

        <section className="content-grid">
          <div className="content-area">
            <Outlet />
          </div>
        </section>
      </main>

      <DotartSide className="app-ornament right" />
    </div>
  );
};

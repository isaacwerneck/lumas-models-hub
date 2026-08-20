"use client";

import { useState, type ComponentType } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  BarChart3, CalendarClock, ChevronRight, CircleDollarSign, ClipboardList,
  LogOut, Menu, MessageCircle, MoonStar, Settings, Sun, Trophy, Users, X
} from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { useTheme } from "./ThemeContext";
import { NotificationCenter } from "./NotificationCenter";
import { DotartSide } from "./DotartSide";
import { motionDurations, motionTokens, pageMotion } from "../lib/motion";

type NavigationItem = {
  to: string;
  label: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  mobilePrimary?: boolean;
};

const managerNavigation: NavigationItem[] = [
  { to: "/home", label: "Visão geral", icon: BarChart3, mobilePrimary: true },
  { to: "/chatters", label: "Equipe", icon: Users, mobilePrimary: true },
  { to: "/pagamentos", label: "Pagamentos", icon: CircleDollarSign, mobilePrimary: true },
  { to: "/chat", label: "Chat", icon: MessageCircle, mobilePrimary: true },
  { to: "/funcionario-do-mes", label: "Ranking", icon: Trophy },
  { to: "/auditoria", label: "Auditoria", icon: ClipboardList },
  { to: "/config", label: "Preferências", icon: Settings }
];

const chatterNavigation: NavigationItem[] = [
  { to: "/horarios", label: "Turnos", icon: CalendarClock, mobilePrimary: true },
  { to: "/pagamento", label: "Ganhos", icon: CircleDollarSign, mobilePrimary: true },
  { to: "/chat", label: "Chat", icon: MessageCircle, mobilePrimary: true },
  { to: "/funcionario-do-mes", label: "Ranking", icon: Trophy, mobilePrimary: true },
  { to: "/config", label: "Preferências", icon: Settings }
];

const NavItem = ({ item, onNavigate }: { item: NavigationItem; onNavigate?: () => void }) => {
  const Icon = item.icon;
  return (
    <NavLink to={item.to} className="shell-nav-link" onClick={onNavigate}>
      <Icon size={19} strokeWidth={1.9} />
      <span>{item.label}</span>
      <ChevronRight className="shell-nav-chevron" size={15} aria-hidden="true" />
    </NavLink>
  );
};

export const AppShell = () => {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const [moreOpen, setMoreOpen] = useState(false);
  const navigation = user?.role === "MANAGER" ? managerNavigation : chatterNavigation;
  const mobilePrimary = navigation.filter((item) => item.mobilePrimary).slice(0, 4);
  const desktopSplit = Math.ceil(navigation.length / 2);

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="app-stage original-stage">
      <div className="bg-atmosphere" aria-hidden="true">
        <div className="bg-aurora" />
        <div className="bg-particle p1" />
        <div className="bg-particle p2" />
        <div className="bg-particle p3" />
        <div className="bg-particle p4" />
        <div className="bg-flowers" />
      </div>

      <DotartSide className="app-ornament left" />

      <div className="shell-account-actions">
        <NotificationCenter />
        <div className="user-chip" title={user?.username}>{user?.displayName}</div>
        <button type="button" className="icon-button" onClick={toggleTheme} aria-label={theme === "dark" ? "Ativar tema claro" : "Ativar tema escuro"} title={theme === "dark" ? "Tema claro" : "Tema escuro"}>
          {theme === "dark" ? <Sun size={18} /> : <MoonStar size={18} />}
        </button>
        <button type="button" className="icon-button" onClick={handleLogout} aria-label="Sair" title="Sair"><LogOut size={18} /></button>
        <button type="button" className="icon-button shell-mobile-more" onClick={() => setMoreOpen(true)} aria-label="Abrir mais opções"><Menu size={21} /></button>
      </div>

      <main className="app-shell">
        <header className="hub-nav-wrap">
          <nav className="hub-nav" aria-label="Navegação principal">
            <div className="hub-nav-group">
              {navigation.slice(0, desktopSplit).map((item) => <NavLink className="menu-link" key={item.to} to={item.to}>{item.label}</NavLink>)}
            </div>
            <NavLink to={user?.role === "MANAGER" ? "/home" : "/horarios"} className="hub-brand-center" aria-label="LumasModels Hub">
              <img className="hub-brand-mark" src="/assets/sidebar-logo.png" alt="" />
              <span className="hub-brand-copy"><strong>Lumas</strong><small>Models Hub</small></span>
            </NavLink>
            <div className="hub-nav-group">
              {navigation.slice(desktopSplit).map((item) => <NavLink className="menu-link" key={item.to} to={item.to}>{item.label}</NavLink>)}
            </div>
          </nav>
        </header>

        <section className="content-grid">
          <div className="content-area" id="main-content">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={location.pathname}
                initial={reduceMotion ? false : pageMotion.initial}
                animate={reduceMotion ? { opacity: 1 } : pageMotion.animate}
                exit={reduceMotion ? { opacity: 0 } : pageMotion.exit}
                transition={{
                  duration: reduceMotion ? motionTokens.duration.instant : motionDurations.base,
                  ease: motionTokens.easing.smooth
                }}
                className="page-transition"
              >
                <Outlet />
              </motion.div>
            </AnimatePresence>
          </div>
        </section>
      </main>

      <DotartSide className="app-ornament right" />

      <nav className="shell-bottom-nav" aria-label="Navegação principal no celular">
        {mobilePrimary.map((item) => {
          const Icon = item.icon;
          return <NavLink key={item.to} to={item.to}><Icon size={21} /><span>{item.label}</span></NavLink>;
        })}
        <button type="button" onClick={() => setMoreOpen(true)}><Menu size={21} /><span>Mais</span></button>
      </nav>

      <AnimatePresence initial={false}>
      {moreOpen ? (
        <motion.div
          key="mobile-more"
          className="shell-drawer-backdrop"
          role="presentation"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? motionTokens.duration.instant : motionDurations.fast, ease: motionTokens.easing.smooth }}
          onMouseDown={() => setMoreOpen(false)}
        >
          <motion.aside
            className="shell-mobile-drawer" role="dialog" aria-modal="true" aria-label="Mais opções"
            initial={reduceMotion ? false : { opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 24 }}
            transition={{ duration: reduceMotion ? motionTokens.duration.instant : motionDurations.fast, ease: motionTokens.easing.smooth }} onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="drawer-heading"><strong>Mais opções</strong><button className="icon-button" onClick={() => setMoreOpen(false)} aria-label="Fechar"><X size={20} /></button></div>
            <nav>{navigation.map((item) => <NavItem item={item} key={item.to} onNavigate={() => setMoreOpen(false)} />)}</nav>
            <button type="button" className="shell-utility-button" onClick={toggleTheme}>{theme === "dark" ? <Sun size={18} /> : <MoonStar size={18} />}<span>Alternar tema</span></button>
            <button type="button" className="shell-utility-button danger" onClick={handleLogout}><LogOut size={18} /><span>Sair da conta</span></button>
          </motion.aside>
        </motion.div>
      ) : null}
      </AnimatePresence>
    </div>
  );
};

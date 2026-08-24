import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import type { Role } from "../types";
import { SessionStatusScreen } from "./SessionStatusScreen";
import { getDefaultRoute } from "../lib/lastVisitedRoute";

export const ProtectedRoute = ({
  children,
  roles
}: {
  children: React.ReactNode;
  roles?: Role[];
}) => {
  const { user, status } = useAuth();
  const location = useLocation();

  if (status === "restoring" || status === "unavailable") {
    return <SessionStatusScreen />;
  }

  if (status === "anonymous" || !user) {
    return <Navigate to="/login" replace />;
  }

  if (roles && !roles.includes(user.role)) {
    return <Navigate to={getDefaultRoute(user.role)} replace />;
  }

  if (user.mustChangePassword && location.pathname !== "/config") {
    return <Navigate to="/config" replace state={{ passwordChangeRequired: true }} />;
  }

  return <>{children}</>;
};

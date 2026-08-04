import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import type { Role } from "../types";

export const ProtectedRoute = ({
  children,
  roles
}: {
  children: React.ReactNode;
  roles?: Role[];
}) => {
  const { user, ready } = useAuth();

  if (!ready) {
    return <div className="screen-center">Carregando...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (roles && !roles.includes(user.role)) {
    return <Navigate to="/home" replace />;
  }

  return <>{children}</>;
};

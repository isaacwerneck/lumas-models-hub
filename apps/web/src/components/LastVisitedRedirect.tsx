import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { getLastVisitedRoute } from "../lib/lastVisitedRoute";
import { SessionStatusScreen } from "./SessionStatusScreen";

export const LastVisitedRedirect = () => {
  const { user, status } = useAuth();

  if (status === "restoring" || status === "unavailable") {
    return <SessionStatusScreen />;
  }

  if (status === "anonymous" || !user) {
    return <Navigate to="/login" replace />;
  }

  return <Navigate to={getLastVisitedRoute(user)} replace />;
};

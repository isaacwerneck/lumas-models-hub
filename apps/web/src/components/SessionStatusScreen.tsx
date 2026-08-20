import { useAuth } from "../auth/AuthContext";

export const SessionStatusScreen = () => {
  const { status, retrySession } = useAuth();

  if (status === "unavailable") {
    return (
      <div className="screen-center session-status-screen">
        <div className="card session-status-card" role="alert">
          <h2>Não foi possível verificar sua sessão</h2>
          <p>Confira sua conexão e tente novamente.</p>
          <button className="primary-button" type="button" onClick={() => void retrySession()}>
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen-center session-status-screen" role="status" aria-live="polite">
      <div className="card session-status-card">
        <h2>Verificando sessão</h2>
        <p>Aguarde um instante...</p>
      </div>
    </div>
  );
};

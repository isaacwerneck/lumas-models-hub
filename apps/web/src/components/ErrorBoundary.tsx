import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
};

type State = {
  hasError: boolean;
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary capturou um erro:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="screen-center">
          <div className="card error-boundary-card">
            <h1>Algo deu errado</h1>
            <p>Ocorreu um erro inesperado nesta tela. Recarregue a página para continuar.</p>
            <button
              className="primary-button"
              type="button"
              onClick={() => {
                this.setState({ hasError: false });
                window.location.reload();
              }}
            >
              Recarregar
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
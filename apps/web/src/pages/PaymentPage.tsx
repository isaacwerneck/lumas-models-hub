import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { api } from "../lib/api";

export const PaymentPage = () => {
  const { user } = useAuth();
  const [summary, setSummary] = useState<any>(null);
  const [review, setReview] = useState<any>(null);
  const [confirmed, setConfirmed] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadChatterData = async () => {
    const [summaryResponse, reviewResponse] = await Promise.all([
      api.get("/chatter/payment/summary"),
      api.get("/chatter/payment/review")
    ]);

    setSummary(summaryResponse.data);
    setReview(reviewResponse.data);
  };

  const loadManagerData = async () => {
    const response = await api.get("/manager/payments/confirmed");
    setConfirmed(response.data.payouts);
  };

  useEffect(() => {
    void (async () => {
      try {
        if (user?.role === "MANAGER") {
          await loadManagerData();
        } else {
          await loadChatterData();
        }
      } catch (requestError: any) {
        setError(requestError?.response?.data?.message ?? "Erro ao carregar dados.");
      }
    })();
  }, [user?.role]);

  const confirmWeek = async () => {
    setError(null);
    try {
      await api.post("/chatter/payment/confirm", {});
      await loadChatterData();
    } catch (requestError: any) {
      setError(requestError?.response?.data?.message ?? "Nao foi possivel confirmar.");
    }
  };

  const markPaid = async (payoutId: string) => {
    await api.post(`/manager/payments/${payoutId}/mark-paid`, {});
    await loadManagerData();
  };

  const forcePay = async (payoutId: string) => {
    const reason = window.prompt("Motivo do pagamento forcado:");
    if (!reason) {
      return;
    }

    await api.post(`/manager/payments/${payoutId}/force-pay`, { reason });
    await loadManagerData();
  };

  if (user?.role === "MANAGER") {
    return (
      <section className="stack-gap">
        <div className="card">
          <h2>Pagamentos confirmados da semana</h2>
          <p>Somente chatters que ja confirmaram os honorarios aparecem aqui.</p>
        </div>

        <div className="card table-card">
          <table>
            <thead>
              <tr>
                <th>Chatter</th>
                <th>Bruto</th>
                <th>A pagar</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {confirmed.map((payout) => (
                <tr key={payout.id}>
                  <td>{payout.chatter.displayName}</td>
                  <td>{payout.weekGrossFormatted}</td>
                  <td>{payout.weekPayoutFormatted}</td>
                  <td className="actions-cell">
                    <button className="primary-button" onClick={() => void markPaid(payout.id)}>
                      Confirmar pagamento
                    </button>
                    <button className="secondary-button" onClick={() => void forcePay(payout.id)}>
                      Forcar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {error ? <div className="error-box">{error}</div> : null}
      </section>
    );
  }

  return (
    <section className="stack-gap">
      <div className="card kpi-grid">
        <div>
          <span>Acumulado da semana</span>
          <strong>{summary?.currentWeek?.payoutFormatted ?? "R$ 0,00"}</strong>
        </div>
        <div>
          <span>Total historico recebido</span>
          <strong>{summary?.lifetime?.paidFormatted ?? "R$ 0,00"}</strong>
        </div>
        <div>
          <span>Dias para o pagamento</span>
          <strong>{summary?.daysUntilNextPayment ?? "-"}</strong>
        </div>
        <div>
          <span>Status</span>
          <strong>{summary?.paymentDone ? "Pago" : summary?.currentWeek?.status ?? "Pendente"}</strong>
        </div>
      </div>

      <div className="card">
        <h2>Revisao da semana</h2>
        <p>Confira horarios e valores antes de confirmar os honorarios.</p>
        {summary?.canConfirmToday ? (
          <button className="primary-button" onClick={() => void confirmWeek()}>
            Confirmar honorarios
          </button>
        ) : (
          <span className="muted">Disponivel somente as segundas-feiras.</span>
        )}
      </div>

      <div className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Modelo</th>
              <th>Inicio</th>
              <th>Fim</th>
              <th>Bruto</th>
              <th>Comissao</th>
            </tr>
          </thead>
          <tbody>
            {(review?.shifts ?? []).map((shift: any) => (
              <tr key={shift.id}>
                <td>{shift.modelTag.name}</td>
                <td>{new Date(shift.startedAt).toLocaleString()}</td>
                <td>{shift.endedAt ? new Date(shift.endedAt).toLocaleString() : "-"}</td>
                <td>{shift.grossAmountFormatted ?? "-"}</td>
                <td>{shift.payoutAmountFormatted ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error ? <div className="error-box">{error}</div> : null}
    </section>
  );
};

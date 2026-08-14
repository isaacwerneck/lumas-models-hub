import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { api } from "../lib/api";

type PaymentSummary = {
  currentWeek?: {
    payoutFormatted?: string;
    status?: string;
  };
  lifetime?: {
    paidFormatted?: string;
  };
  daysUntilNextPayment?: number;
  paymentDone?: boolean;
  canConfirmToday?: boolean;
};

type ReviewShift = {
  id: string;
  modelTag: { name: string };
  startedAt: string;
  endedAt: string | null;
  startValueCents: number;
  endValueCents: number | null;
  grossAmountFormatted: string | null;
  payoutAmountFormatted: string | null;
  negativeJustification: string | null;
};

type ReviewData = {
  shifts: ReviewShift[];
};

const formatCentsToBrl = (cents: number | null) => {
  if (cents === null) {
    return "";
  }

  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(cents / 100);
};

const toDateTimeLocalValue = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const toDateTimeLocalFromIso = (iso: string | null) => {
  if (!iso) {
    return "";
  }

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return toDateTimeLocalValue(date);
};

const parseDateTimeLocalToIso = (value: string) => {
  if (!value.trim()) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
};

export const PaymentPage = () => {
  const { user } = useAuth();
  const [summary, setSummary] = useState<PaymentSummary | null>(null);
  const [review, setReview] = useState<ReviewData | null>(null);
  const [confirmed, setConfirmed] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [editingShiftId, setEditingShiftId] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingShiftId, setDeletingShiftId] = useState<string | null>(null);

  const [editStartedAt, setEditStartedAt] = useState("");
  const [editEndedAt, setEditEndedAt] = useState("");
  const [editStartValue, setEditStartValue] = useState("");
  const [editEndValue, setEditEndValue] = useState("");
  const [editNegativeJustification, setEditNegativeJustification] = useState("");

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
    setMessage(null);
    try {
      await api.post("/chatter/payment/confirm", {});
      await loadChatterData();
      setMessage("Honorarios confirmados com sucesso.");
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

  const openShiftEditor = (shift: ReviewShift) => {
    setEditingShiftId(shift.id);
    setEditStartedAt(toDateTimeLocalFromIso(shift.startedAt));
    setEditEndedAt(toDateTimeLocalFromIso(shift.endedAt));
    setEditStartValue(formatCentsToBrl(shift.startValueCents));
    setEditEndValue(formatCentsToBrl(shift.endValueCents));
    setEditNegativeJustification(shift.negativeJustification ?? "");
  };

  const saveShiftEdit = async () => {
    if (!editingShiftId) {
      return;
    }

    const startedAt = parseDateTimeLocalToIso(editStartedAt);
    const endedAt = parseDateTimeLocalToIso(editEndedAt);

    if (!startedAt || !endedAt) {
      setError("Preencha data/hora valida para inicio e fim do lancamento.");
      return;
    }

    setSavingEdit(true);
    setError(null);
    setMessage(null);

    try {
      await api.patch(`/chatter/shifts/${editingShiftId}`, {
        startedAt,
        endedAt,
        startValue: editStartValue,
        endValue: editEndValue,
        negativeJustification: editNegativeJustification || undefined
      });

      setEditingShiftId(null);
      await loadChatterData();
      setMessage("Lancamento atualizado com sucesso.");
    } catch (requestError: any) {
      setError(requestError?.response?.data?.message ?? "Nao foi possivel atualizar o lancamento.");
    } finally {
      setSavingEdit(false);
    }
  };

  const removeShift = async (shiftId: string) => {
    const accepted = window.confirm("Deseja realmente apagar este lancamento?");
    if (!accepted) {
      return;
    }

    setDeletingShiftId(shiftId);
    setError(null);
    setMessage(null);

    try {
      await api.delete(`/chatter/shifts/${shiftId}`);
      if (editingShiftId === shiftId) {
        setEditingShiftId(null);
      }
      await loadChatterData();
      setMessage("Lancamento apagado com sucesso.");
    } catch (requestError: any) {
      setError(requestError?.response?.data?.message ?? "Nao foi possivel apagar o lancamento.");
    } finally {
      setDeletingShiftId(null);
    }
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
              <th>Acoes</th>
            </tr>
          </thead>
          <tbody>
            {(review?.shifts ?? []).map((shift) => (
              <tr key={shift.id}>
                <td>{shift.modelTag.name}</td>
                <td>{new Date(shift.startedAt).toLocaleString()}</td>
                <td>{shift.endedAt ? new Date(shift.endedAt).toLocaleString() : "-"}</td>
                <td>{shift.grossAmountFormatted ?? "-"}</td>
                <td>{shift.payoutAmountFormatted ?? "-"}</td>
                <td className="actions-cell">
                  <button className="secondary-button" onClick={() => openShiftEditor(shift)}>
                    Editar
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => void removeShift(shift.id)}
                    disabled={deletingShiftId === shift.id}
                  >
                    {deletingShiftId === shift.id ? "Apagando..." : "Apagar"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editingShiftId ? (
        <div className="card form-grid">
          <h2>Editar lancamento da semana</h2>

          <label>
            Inicio
            <input
              type="datetime-local"
              value={editStartedAt}
              onChange={(e) => setEditStartedAt(e.target.value)}
              required
            />
          </label>

          <label>
            Fim
            <input
              type="datetime-local"
              value={editEndedAt}
              onChange={(e) => setEditEndedAt(e.target.value)}
              required
            />
          </label>

          <label>
            Valor inicial BRL
            <input value={editStartValue} onChange={(e) => setEditStartValue(e.target.value)} placeholder="R$ 100,00" />
          </label>

          <label>
            Valor final BRL
            <input value={editEndValue} onChange={(e) => setEditEndValue(e.target.value)} placeholder="R$ 150,00" />
          </label>

          <label>
            Justificativa saldo negativo
            <textarea
              value={editNegativeJustification}
              onChange={(e) => setEditNegativeJustification(e.target.value)}
              placeholder="Obrigatoria quando bruto for negativo."
            />
          </label>

          <div className="actions-cell">
            <button className="primary-button" type="button" onClick={() => void saveShiftEdit()} disabled={savingEdit}>
              {savingEdit ? "Salvando..." : "Salvar alteracoes"}
            </button>
            <button className="secondary-button" type="button" onClick={() => setEditingShiftId(null)}>
              Cancelar
            </button>
          </div>
        </div>
      ) : null}

      {message ? <div className="success-box">{message}</div> : null}
      {error ? <div className="error-box">{error}</div> : null}
    </section>
  );
};

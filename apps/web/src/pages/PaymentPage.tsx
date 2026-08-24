import { useEffect, useState } from "react";
import { BadgeCheck, Check, CircleAlert, Eye, Pencil, Trash2, Undo2 } from "lucide-react";
import { Navigate, useSearchParams } from "react-router-dom";
import type { Pagination } from "@lumas/contracts";
import { useAuth } from "../auth/AuthContext";
import { api } from "../lib/api";
import { formatBrl } from "../lib/money";
import { useToast } from "../components/Toast";
import { getApiErrorMessage } from "../lib/apiError";
import { ModalDialog } from "../components/ModalDialog";
import { formatDateTime } from "../lib/dateTime";
import { EvidenceLink } from "../components/EvidenceLink";
import type { EvidenceSummary } from "../types/api";

type PaymentSummary = {
  pendingCents: number;
  pendingFormatted: string;
  lifetimePaidCents: number;
  lifetimePaidFormatted: string;
  thisMonthPaidCents: number;
  thisMonthPaidFormatted: string;
  lastMonthPaidCents: number;
  lastMonthPaidFormatted: string;
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
  notes: string | null;
  chatterVerifiedAt: string | null;
  startEvidence?: EvidenceSummary | null;
  endEvidence?: EvidenceSummary | null;
  reconciliation?: { status: "MATCHED" | "MISMATCH" | "OUT_OF_RANGE" | "AMBIGUOUS" | "OVERRIDDEN"; deltaCents: number } | null;
};

type ReviewData = {
  shifts: ReviewShift[];
};

type PaymentRecord = {
  id: string;
  totalCents: number;
  totalFormatted: string;
  paidAt: string;
  manager: { id: string; displayName: string };
  receipt?: { id: string; originalName: string } | null;
};

const PaymentReceiptLink = ({ receipt }: { receipt: { id: string; originalName: string } }) => {
  const toast = useToast();
  const open = async () => {
    try {
      const response = await api.get(`/payment-receipts/${receipt.id}/content`, { responseType: "blob" });
      const url = URL.createObjectURL(response.data); window.open(url, "_blank", "noopener,noreferrer"); window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) { toast.error(getApiErrorMessage(error, "Não foi possível abrir o comprovante de pagamento.")); }
  };
  return <button type="button" className="evidence-link" onClick={() => void open()}><Eye size={15} /> {receipt.originalName}</button>;
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

const shiftMph = (shift: ReviewShift) => {
  if (!shift.endedAt || shift.endValueCents === null) {
    return null;
  }

  const grossCents = shift.endValueCents - shift.startValueCents;
  const durationMs = new Date(shift.endedAt).getTime() - new Date(shift.startedAt).getTime();
  if (durationMs < 0) {
    return null;
  }

  const hoursMs = Math.max(durationMs, 60_000);

  return `${formatBrl((grossCents / 100) / (hoursMs / 3600000))}/h`;
};

export const PaymentPage = () => {
  const { user } = useAuth();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const paymentPage = Number(searchParams.get("paymentPage") ?? 1);
  const shiftPage = Number(searchParams.get("shiftPage") ?? 1);
  const [summary, setSummary] = useState<PaymentSummary | null>(null);
  const [review, setReview] = useState<ReviewData | null>(null);
  const [history, setHistory] = useState<PaymentRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [paymentPagination, setPaymentPagination] = useState<Pagination>({ page: 1, pageSize: 20, total: 0, totalPages: 1 });
  const [shiftPagination, setShiftPagination] = useState<Pagination>({ page: 1, pageSize: 10, total: 0, totalPages: 1 });

  const [editingShiftId, setEditingShiftId] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingShiftId, setDeletingShiftId] = useState<string | null>(null);
  const [deleteTargetShiftId, setDeleteTargetShiftId] = useState<string | null>(null);

  const [editStartedAt, setEditStartedAt] = useState("");
  const [editEndedAt, setEditEndedAt] = useState("");
  const [editStartValue, setEditStartValue] = useState("");
  const [editEndValue, setEditEndValue] = useState("");
  const [editNegativeJustification, setEditNegativeJustification] = useState("");
  const [editNotes, setEditNotes] = useState("");

  const loadChatterData = async () => {
    const [summaryResponse, historyResponse, shiftsResponse] = await Promise.all([
      api.get("/chatter/payment/summary"),
      api.get("/chatter/payment/history", { params: { page: paymentPage, pageSize: 20 } }),
      api.get("/chatter/payment/review", { params: { page: shiftPage, pageSize: 10 } })
    ]);

    setSummary(summaryResponse.data);
    setHistory(historyResponse.data.items);
    setReview({ shifts: shiftsResponse.data.items });
    setPaymentPagination(historyResponse.data.pagination);
    setShiftPagination(shiftsResponse.data.pagination);
  };

  useEffect(() => {
    void (async () => {
      try {
        if (user?.role !== "MANAGER") {
          await loadChatterData();
        }
      } catch (requestError: unknown) {
        setError(getApiErrorMessage(requestError, "Erro ao carregar dados."));
      } finally {
        setLoading(false);
      }
    })();
  }, [user?.role, paymentPage, shiftPage]);

  const changePage = (key: "paymentPage" | "shiftPage", value: number) => {
    const next = new URLSearchParams(searchParams);
    next.set(key, String(value));
    setSearchParams(next);
  };

  const openShiftEditor = (shift: ReviewShift) => {
    setEditingShiftId(shift.id);
    setEditStartedAt(toDateTimeLocalFromIso(shift.startedAt));
    setEditEndedAt(toDateTimeLocalFromIso(shift.endedAt));
    setEditStartValue(formatCentsToBrl(shift.startValueCents));
    setEditEndValue(formatCentsToBrl(shift.endValueCents));
    setEditNegativeJustification(shift.negativeJustification ?? "");
    setEditNotes(shift.notes ?? "");
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

    if (new Date(endedAt) <= new Date(startedAt)) {
      const feedback = "A data/hora final precisa ser posterior ao início do lançamento.";
      setError(feedback);
      return;
    }

    setSavingEdit(true);
    setError(null);

    try {
      await api.patch(`/chatter/shifts/${editingShiftId}`, {
        startedAt,
        endedAt,
        startValue: editStartValue,
        endValue: editEndValue,
        negativeJustification: editNegativeJustification || undefined,
        notes: editNotes
      });

      setEditingShiftId(null);
      await loadChatterData();
      toast.success("Lançamento atualizado com sucesso.");
    } catch (requestError: unknown) {
      const feedback = getApiErrorMessage(requestError, "Nao foi possivel atualizar o lancamento.");
      toast.error(feedback);
    } finally {
      setSavingEdit(false);
    }
  };

  const removeShift = async (shiftId: string) => {
    setDeletingShiftId(shiftId);
    setError(null);

    try {
      await api.delete(`/chatter/shifts/${shiftId}`);
      setDeleteTargetShiftId(null);
      if (editingShiftId === shiftId) {
        setEditingShiftId(null);
      }
      await loadChatterData();
      toast.success("Lançamento apagado com sucesso.");
    } catch (requestError: unknown) {
      const feedback = getApiErrorMessage(requestError, "Nao foi possivel apagar o lancamento.");
      toast.error(feedback);
    } finally {
      setDeletingShiftId(null);
    }
  };

  const toggleVerified = async (shift: ReviewShift) => {
    try {
      if (shift.chatterVerifiedAt) await api.delete(`/chatter/shifts/${shift.id}/verify`);
      else await api.post(`/chatter/shifts/${shift.id}/verify`);
      await loadChatterData();
      toast.success(shift.chatterVerifiedAt ? "Confirmação desfeita. Você pode editar o horário novamente." : "Horário confirmado e liberado para conferência do gerente.");
    } catch (requestError: unknown) {
      toast.error(getApiErrorMessage(requestError, "Não foi possível alterar a confirmação."));
    }
  };

  if (user?.role === "MANAGER") {
    return <Navigate to="/pagamentos" replace />;
  }

  return (
    <section className="stack-gap">
      <div className="page-header">
        <div>
          <h1>Pagamento</h1>
          <p>Revise cada horário e confirme somente quando valores e capturas estiverem corretos.</p>
        </div>
      </div>
      {loading ? <div className="card skeleton-grid" aria-label="Carregando pagamentos"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div> : <div className="card kpi-grid">
        <div>
          <span>Saldo pendente</span>
          <strong>{summary?.pendingFormatted ?? "R$ 0,00"}</strong>
        </div>
        <div>
          <span>Mês anterior</span>
          <strong>{summary?.lastMonthPaidFormatted ?? "R$ 0,00"}</strong>
        </div>
        <div>
          <span>Este mês</span>
          <strong>{summary?.thisMonthPaidFormatted ?? "R$ 0,00"}</strong>
        </div>
        <div>
          <span>Total recebido</span>
          <strong>{summary?.lifetimePaidFormatted ?? "R$ 0,00"}</strong>
        </div>
      </div>}

      <div className="card table-card" tabIndex={0} aria-label="Histórico de pagamentos">
        <h2>Historico de pagamentos</h2>
        {!loading ? <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Valor pago</th>
              <th>Gerente</th>
              <th>Comprovante</th>
            </tr>
          </thead>
          <tbody>
            {history.map((record) => (
              <tr key={record.id}>
                <td>{formatDateTime(record.paidAt)}</td>
                <td>{record.totalFormatted}</td>
                <td>{record.manager.displayName}</td>
                <td>{record.receipt ? <PaymentReceiptLink receipt={record.receipt} /> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table> : <div className="skeleton-list"><div className="skeleton" /><div className="skeleton" /></div>}
        {!loading && history.length === 0 ? <p className="empty-hint">Nenhum pagamento recebido ainda.</p> : null}
        {paymentPagination.totalPages > 1 ? <div className="pagination"><button className="secondary-button" disabled={paymentPagination.page <= 1} onClick={() => changePage("paymentPage", paymentPage - 1)}>Anterior</button><span>Página {paymentPagination.page} de {paymentPagination.totalPages}</span><button className="secondary-button" disabled={paymentPagination.page >= paymentPagination.totalPages} onClick={() => changePage("paymentPage", paymentPage + 1)}>Próxima</button></div> : null}
      </div>

      <div className="card review-list-card" tabIndex={0} aria-label="Lançamentos">
        <h2>Lancamentos</h2>
        {!loading ? <div className="review-list">
          {(review?.shifts ?? []).map((shift) => (
            <article className="review-card" key={shift.id}>
              <header className="review-card-header">
                <div><span className="review-card-eyebrow">Modelo</span><strong>{shift.modelTag.name}</strong></div>
                <div className="review-status-cell">
                  <span className={`review-status ${shift.chatterVerifiedAt ? "is-confirmed" : "is-pending"}`}>
                    {shift.chatterVerifiedAt ? <BadgeCheck size={16} /> : <CircleAlert size={16} />}
                    {shift.chatterVerifiedAt ? "Confirmado" : "Revisão pendente"}
                  </span>
                </div>
              </header>
              <div className="review-card-main">
                <div className="review-time-grid">
                  <div><span>Início</span><strong>{formatDateTime(shift.startedAt)}</strong></div>
                  <div><span>Fim</span><strong>{shift.endedAt ? formatDateTime(shift.endedAt) : "—"}</strong></div>
                </div>
                <div className="review-metric-grid">
                  <div><span>Bruto</span><strong>{shift.grossAmountFormatted ?? "—"}</strong></div>
                  <div><span>Comissão</span><strong>{shift.payoutAmountFormatted ?? "—"}</strong></div>
                  <div><span>MPH</span><strong>{shiftMph(shift) ?? "—"}</strong></div>
                </div>
                <div className="review-captures"><span>Capturas</span><div className="evidence-pair"><EvidenceLink evidence={shift.startEvidence} /><EvidenceLink evidence={shift.endEvidence} /></div></div>
              </div>
              <footer className="review-card-footer">
                <span>{shift.chatterVerifiedAt ? "Você pode reabrir a revisão se precisar corrigir este lançamento." : "Confira dados e capturas antes de confirmar."}</span>
                <div className="review-actions-cell">
                  <div className="review-actions">
                    <button type="button" className={shift.chatterVerifiedAt ? "review-reopen-button" : "review-confirm-button"} onClick={() => void toggleVerified(shift)}>
                      {shift.chatterVerifiedAt ? <Undo2 size={15} /> : <Check size={16} />}
                      {shift.chatterVerifiedAt ? "Reabrir" : "Confirmar"}
                    </button>
                    {!shift.chatterVerifiedAt ? <>
                      <button type="button" className="review-icon-button" onClick={() => openShiftEditor(shift)} aria-label={`Editar horário de ${shift.modelTag.name}`} title="Editar horário"><Pencil size={16} /></button>
                      <button type="button" className="review-icon-button is-danger" onClick={() => setDeleteTargetShiftId(shift.id)} disabled={deletingShiftId === shift.id} aria-label={`Apagar horário de ${shift.modelTag.name}`} title="Apagar horário"><Trash2 size={16} /></button>
                    </> : null}
                  </div>
                </div>
              </footer>
            </article>
            ))}
        </div> : <div className="skeleton-list"><div className="skeleton" /><div className="skeleton" /></div>}
        {!loading && (review?.shifts.length ?? 0) === 0 ? <p className="empty-hint">Nenhum turno fechado para revisar.</p> : null}
        {shiftPagination.totalPages > 1 ? <div className="pagination"><button className="secondary-button" disabled={shiftPagination.page <= 1} onClick={() => changePage("shiftPage", shiftPage - 1)}>Anterior</button><span>Página {shiftPagination.page} de {shiftPagination.totalPages}</span><button className="secondary-button" disabled={shiftPagination.page >= shiftPagination.totalPages} onClick={() => changePage("shiftPage", shiftPage + 1)}>Próxima</button></div> : null}
      </div>

      <ModalDialog open={Boolean(editingShiftId)} onClose={() => !savingEdit && setEditingShiftId(null)} ariaLabel="Editar lançamento" panelClassName="shift-edit-modal">
        {editingShiftId ? <div className="form-grid">
          <h2>Editar lancamento</h2>
          <p className="modal-intro">Altere os dados necessários e salve. O lançamento voltará para revisão.</p>

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

          <label>
            Observações
            <textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} maxLength={500} placeholder="Contexto opcional do turno." />
            <small className="field-hint">{editNotes.length}/500</small>
          </label>

          <div className="modal-actions">
            <button className="primary-button" type="button" onClick={() => void saveShiftEdit()} disabled={savingEdit}>
              {savingEdit ? "Salvando..." : "Salvar alteracoes"}
            </button>
            <button className="secondary-button" type="button" onClick={() => setEditingShiftId(null)} disabled={savingEdit}>
              Cancelar
            </button>
          </div>
        </div>
        : null}
      </ModalDialog>

      <ModalDialog open={Boolean(deleteTargetShiftId)} onClose={() => setDeleteTargetShiftId(null)} ariaLabel="Excluir lançamento">
        {deleteTargetShiftId ? <>
        <h2>Excluir lançamento</h2><p>Esta ação não pode ser desfeita. Deseja continuar?</p>
        <div className="modal-actions"><button className="secondary-button" onClick={() => setDeleteTargetShiftId(null)}>Cancelar</button><button className="danger-button" disabled={deletingShiftId === deleteTargetShiftId} onClick={() => void removeShift(deleteTargetShiftId)}>{deletingShiftId ? "Excluindo..." : "Excluir"}</button></div>
        </> : null}
      </ModalDialog>

      {error ? <div className="error-box">{error}</div> : null}
    </section>
  );
};

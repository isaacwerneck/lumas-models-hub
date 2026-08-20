import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Pagination } from "@lumas/contracts";
import { api, downloadApiFile } from "../lib/api";
import { useToast } from "../components/Toast";
import { getApiErrorMessage } from "../lib/apiError";
import { ModalDialog } from "../components/ModalDialog";
import { formatDateTime } from "../lib/dateTime";
import { EvidenceLink } from "../components/EvidenceLink";
import type { EvidenceSummary } from "../types/api";

type Shift = {
  id: string;
  modelTag: { id: string; name: string };
  status: string;
  startedAt: string;
  endedAt: string | null;
  startImageUrl: string | null;
  startEvidence?: EvidenceSummary | null;
  startValueFormatted: string;
  endImageUrl: string | null;
  endEvidence?: EvidenceSummary | null;
  endValueFormatted: string | null;
  grossAmountFormatted: string | null;
  payoutAmountFormatted: string | null;
  negativeJustification: string | null;
  notes: string | null;
  earnings: { amountFormatted: string; status: string; paidAt: string | null } | null;
};

type Payment = {
  id: string;
  totalFormatted: string;
  paidAt: string;
  manager: { id: string; displayName: string };
};

type Tag = { id: string; name: string; isActive: boolean };
type ChatterDetail = {
  id: string;
  username: string;
  displayName: string;
  isActive: boolean;
  modelTags: Tag[];
};


export const ManagerChatterDetailPage = () => {
  const { chatterId } = useParams<{ chatterId: string }>();
  const toast = useToast();
  const [chatter, setChatter] = useState<ChatterDetail | null>(null);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({});
  const [savingNotesId, setSavingNotesId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState<string | null>(null);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [shiftPagination, setShiftPagination] = useState<Pagination>({ page: 1, pageSize: 10, total: 0, totalPages: 1 });
  const PAGE_SIZE = 10;

  const loadData = async () => {
    const [detailResponse, shiftsResponse, paymentsResponse, tagsResponse] = await Promise.all([
      api.get(`/manager/chatters/${chatterId}`),
      api.get(`/manager/chatters/${chatterId}/shifts`, { params: { page, pageSize: PAGE_SIZE, search: debouncedSearch || undefined } }),
      api.get(`/manager/chatters/${chatterId}/payments`, { params: { page: 1, pageSize: 20 } }),
      api.get("/manager/tags")
    ]);
    const data = detailResponse.data.chatter;
    setChatter(data);
    setShifts(shiftsResponse.data.items);
    setPayments(paymentsResponse.data.items);
    setShiftPagination(shiftsResponse.data.pagination);
    setAllTags(tagsResponse.data.tags);
    setSelectedTags(data.modelTags.map((tag: Tag) => tag.id));
  };

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    void loadData().catch((requestError: unknown) => {
      setError(getApiErrorMessage(requestError, "Erro ao carregar histórico."));
    });
  }, [chatterId, page, debouncedSearch]);

  const toggleTag = (id: string) => {
    setSelectedTags((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
    );
  };

  const saveTags = async () => {
    if (!chatterId) {
      return;
    }
    try {
      await api.put(`/manager/chatters/${chatterId}/tags`, { modelTagIds: selectedTags });
      toast.success("Tags atualizadas com sucesso.");
      await loadData();
    } catch (requestError: unknown) {
      const feedback = getApiErrorMessage(requestError, "Erro ao salvar tags.");
      toast.error(feedback);
    }
  };

  const saveNotes = async (shiftId: string) => {
    setSavingNotesId(shiftId);
    try {
      await api.patch(`/manager/shifts/${shiftId}/notes`, { notes: notesDraft[shiftId] ?? "" });
      toast.success("Observação salva.");
      await loadData();
    } catch (requestError: unknown) {
      const feedback = getApiErrorMessage(requestError, "Erro ao salvar observação.");
      toast.error(feedback);
    } finally {
      setSavingNotesId(null);
    }
  };

  const submitPasswordReset = async () => {
    if (!chatterId || !resetPassword) return;
    setResettingPassword(true);
    try {
      await api.post(`/manager/users/${chatterId}/reset-password`, { password: resetPassword });
      toast.success("Senha temporária criada e sessões anteriores encerradas.");
      setResetPassword(null);
    } catch (requestError) {
      toast.error(getApiErrorMessage(requestError, "Não foi possível redefinir a senha."));
    } finally {
      setResettingPassword(false);
    }
  };

  const totalPages = shiftPagination.totalPages;
  const safePage = shiftPagination.page;
  const pageShifts = shifts;
  const savedTagIds = chatter?.modelTags.map((tag) => tag.id) ?? [];
  const tagsDirty = selectedTags.length !== savedTagIds.length || selectedTags.some((id) => !savedTagIds.includes(id));

  if (!chatter) {
    return (
      <section className="stack-gap">
        <div className="card skeleton-list" aria-label="Carregando detalhes do chatter">
          <div className="skeleton" />
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
        {error ? <div className="error-box">{error}</div> : null}
      </section>
    );
  }

  return (
    <section className="stack-gap">
      <div className="page-header">
        <div>
          <h1>{chatter.displayName}</h1>
          <p>
            @{chatter.username} ·{" "}
            <span className={chatter.isActive ? "status-badge paid" : "status-badge"}>
              {chatter.isActive ? "Ativo" : "Inativo"}
            </span>
          </p>
        </div>
        <div className="page-header-actions"><button type="button" className="secondary-button" onClick={() => setResetPassword(`Lumas@${crypto.randomUUID().slice(0, 8)}`)}>Redefinir senha</button><Link to="/chatters" className="back-link" aria-label="Voltar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5" />
            <path d="M12 19l-7-7 7-7" />
          </svg>
        </Link></div>
      </div>

      <ModalDialog open={Boolean(resetPassword)} onClose={() => setResetPassword(null)} ariaLabel="Redefinir senha">
        {resetPassword ? <><h2>Redefinir senha</h2><p>O chatter será desconectado em todos os dispositivos e precisará trocar esta senha no próximo acesso.</p><label>Senha temporária<input value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} minLength={8} autoComplete="new-password" /></label><div className="modal-actions"><button className="secondary-button" onClick={() => setResetPassword(null)} disabled={resettingPassword}>Cancelar</button><button className="primary-button" onClick={() => void submitPasswordReset()} disabled={resettingPassword || resetPassword.length < 8}>{resettingPassword ? "Redefinindo…" : "Redefinir e encerrar sessões"}</button></div></> : null}
      </ModalDialog>

      <div className="card form-grid">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
          <h2>Tags de modelo</h2>
          <Link to="/tags" className="secondary-button" style={{ fontSize: "0.8rem", padding: "0.35rem 0.75rem" }}>
            Gerenciar tags
          </Link>
        </div>

        {allTags.length === 0 ? (
          <p className="empty-hint" style={{ textAlign: "left", padding: "0.5rem 0" }}>
            Nenhuma tag cadastrada no sistema. <Link to="/tags" style={{ color: "var(--brand-magenta)", fontWeight: "bold" }}>Clique aqui para criar</Link>.
          </p>
        ) : (
          <div className="tag-cloud">
            {allTags.map((tag) => {
              const checked = selectedTags.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  className={checked ? "tag-pill active" : "tag-pill"}
                  onClick={() => toggleTag(tag.id)}
                >
                  {tag.name}
                </button>
              );
            })}
          </div>
        )}

        <button className="primary-button" type="button" onClick={() => void saveTags()} disabled={allTags.length === 0 || !tagsDirty}>
          Salvar tags
        </button>
      </div>

      <div className="card table-card" tabIndex={0} aria-label="Turnos do chatter">
        <h2>Horas subidas (turnos)</h2>
        <div className="list-toolbar">
          <input
            type="search"
            placeholder="Buscar por modelo..."
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            className="search-input"
          />
          <span className="list-count">
            {shiftPagination.total} {shiftPagination.total === 1 ? "turno" : "turnos"}
          </span>
          <button className="secondary-button" type="button" onClick={() => void downloadApiFile(
            "/manager/reports/shifts.xlsx",
            `turnos-${chatter.username}.xlsx`,
            { chatterId: chatter.id, ...(debouncedSearch ? { search: debouncedSearch } : {}) }
          )}>XLSX</button>
        </div>
        <table>
          <thead>
            <tr>
              <th>Modelo</th>
              <th>Início</th>
              <th>Fim</th>
              <th>Imagem início</th>
              <th>Valor início</th>
              <th>Imagem fim</th>
              <th>Valor fim</th>
              <th>Bruto</th>
              <th>Payout</th>
              <th>Ganho</th>
              <th>Observação</th>
            </tr>
          </thead>
          <tbody>
            {pageShifts.map((shift) => (
              <tr key={shift.id}>
                <td>{shift.modelTag.name}</td>
                <td>{formatDateTime(shift.startedAt)}</td>
                <td>{shift.endedAt ? formatDateTime(shift.endedAt) : "—"}</td>
                <td><EvidenceLink evidence={shift.startEvidence} fallbackName={shift.startImageUrl} /></td>
                <td>{shift.startValueFormatted}</td>
                <td><EvidenceLink evidence={shift.endEvidence} fallbackName={shift.endImageUrl} /></td>
                <td>{shift.endValueFormatted ?? "—"}</td>
                <td>{shift.grossAmountFormatted ?? "—"}</td>
                <td>{shift.payoutAmountFormatted ?? "—"}</td>
                <td>
                  {shift.earnings ? (
                    <span
                      className={
                        shift.earnings.status === "PAID" ? "status-badge paid" : "status-badge pending"
                      }
                    >
                      {shift.earnings.amountFormatted} ·{" "}
                      {shift.earnings.status === "PAID" ? "Pago" : "Pendente"}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  <div className="notes-cell">
                    <textarea
                      value={notesDraft[shift.id] ?? shift.notes ?? ""}
                      onChange={(event) =>
                        setNotesDraft((current) => ({ ...current, [shift.id]: event.target.value }))
                      }
                      placeholder="Observação opcional"
                      rows={2}
                      maxLength={500}
                    />
                    {(notesDraft[shift.id] ?? shift.notes ?? "") !== (shift.notes ?? "") ? (
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={savingNotesId === shift.id}
                        onClick={() => void saveNotes(shift.id)}
                      >
                        {savingNotesId === shift.id ? "Salvando..." : "Salvar"}
                      </button>
                    ) : null}
                  </div>
                </td>
                </tr>
              ))}
            </tbody>
          </table>
          {shifts.length === 0 ? (
            <p className="empty-hint">{search ? "Nenhum turno encontrado com essa busca." : "Nenhum turno registrado."}</p>
          ) : null}
          {totalPages > 1 ? (
            <div className="pagination">
              <button
                type="button"
                className="secondary-button"
                disabled={safePage <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                Anterior
              </button>
              <span className="pagination-info">
                Página {safePage} de {totalPages}
              </span>
              <button
                type="button"
                className="secondary-button"
                disabled={safePage >= totalPages}
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              >
                Próxima
              </button>
            </div>
          ) : null}
        </div>

      <div className="card table-card" tabIndex={0} aria-label="Pagamentos do chatter">
        <h2>Histórico de pagamentos</h2>
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Valor</th>
              <th>Gerente</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((payment) => (
              <tr key={payment.id}>
                <td>{formatDateTime(payment.paidAt)}</td>
                <td>{payment.totalFormatted}</td>
                <td>{payment.manager.displayName}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {payments.length === 0 ? <p className="empty-hint">Nenhum pagamento registrado para este chatter.</p> : null}
      </div>

      {error ? <div className="error-box">{error}</div> : null}
    </section>
  );
};

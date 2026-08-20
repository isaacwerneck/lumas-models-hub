import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { Pagination } from "@lumas/contracts";
import { api, downloadApiFile } from "../lib/api";
import { useToast } from "../components/Toast";
import { getApiErrorMessage } from "../lib/apiError";
import { formatDateTime } from "../lib/dateTime";
import { ModalDialog } from "../components/ModalDialog";

type BalanceChatter = { id: string; displayName: string; isActive: boolean; pendingCents: number; pendingFormatted: string };
type PaymentRecord = { id: string; chatter: { id: string; displayName: string }; manager: { id: string; displayName: string }; totalCents: number; totalFormatted: string; paidAt: string };
const emptyPagination: Pagination = { page: 1, pageSize: 20, total: 0, totalPages: 1 };

export const ManagerPaymentsPage = () => {
  const [params, setParams] = useSearchParams();
  const search = params.get("search") ?? "";
  const balancePage = Number(params.get("balancePage") ?? 1);
  const historyPage = Number(params.get("historyPage") ?? 1);
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [chatters, setChatters] = useState<BalanceChatter[]>([]);
  const [history, setHistory] = useState<PaymentRecord[]>([]);
  const [balancePagination, setBalancePagination] = useState<Pagination>(emptyPagination);
  const [historyPagination, setHistoryPagination] = useState<Pagination>(emptyPagination);
  const [payTarget, setPayTarget] = useState<BalanceChatter | null>(null);
  const [paying, setPaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => { const timer = window.setTimeout(() => setDebouncedSearch(search), 300); return () => window.clearTimeout(timer); }, [search]);

  const loadData = async () => {
    setLoading(true); setError(null);
    try {
      const [balancesResponse, historyResponse] = await Promise.all([
        api.get("/manager/payments/balances", { params: { page: balancePage, pageSize: 20, search: debouncedSearch || undefined } }),
        api.get("/manager/payments/history", { params: { page: historyPage, pageSize: 20, search: debouncedSearch || undefined } })
      ]);
      setChatters(balancesResponse.data.items); setHistory(historyResponse.data.items);
      setBalancePagination(balancesResponse.data.pagination); setHistoryPagination(historyResponse.data.pagination);
    } catch (requestError: unknown) {
      setError(getApiErrorMessage(requestError, "Erro ao carregar pagamentos."));
    } finally { setLoading(false); }
  };
  useEffect(() => { void loadData(); }, [debouncedSearch, balancePage, historyPage]);

  const updateParams = (changes: Record<string, string | number>) => {
    const next = new URLSearchParams(params); Object.entries(changes).forEach(([key, value]) => next.set(key, String(value))); setParams(next);
  };
  const confirmPay = async () => {
    if (!payTarget) return; setPaying(true);
    try {
      const response = await api.post("/manager/payments/pay", { chatterId: payTarget.id }, { headers: { "Idempotency-Key": crypto.randomUUID() } });
      setPayTarget(null);
      await loadData();
      const purgeCount = Number(response.data.purgedEvidenceCount ?? 0);
      toast.success(purgeCount > 0 ? `Pagamento registrado. ${purgeCount} comprovante(s) enviado(s) para limpeza segura.` : "Pagamento registrado com sucesso.");
    }
    catch (requestError: unknown) { toast.error(getApiErrorMessage(requestError, "Não foi possível registrar o pagamento.")); }
    finally { setPaying(false); }
  };
  const exportHistory = () => void downloadApiFile("/manager/reports/payments.xlsx", `pagamentos-${new Date().toISOString().slice(0, 10)}.xlsx`, debouncedSearch ? { search: debouncedSearch } : undefined);
  const renderPagination = (value: Pagination, key: "balancePage" | "historyPage") => value.totalPages > 1 ? <div className="pagination">
    <button className="secondary-button" disabled={value.page <= 1} onClick={() => updateParams({ [key]: value.page - 1 })}>Anterior</button><span>Página {value.page} de {value.totalPages}</span><button className="secondary-button" disabled={value.page >= value.totalPages} onClick={() => updateParams({ [key]: value.page + 1 })}>Próxima</button>
  </div> : null;

  return <section className="stack-gap">
    <div className="page-header"><div><h1>Pagamentos</h1><p>Consulte saldos e registre pagamentos realizados.</p></div></div>
    <div className="card list-toolbar"><input type="search" className="search-input" placeholder="Buscar chatter..." value={search} onChange={(event) => updateParams({ search: event.target.value, balancePage: 1, historyPage: 1 })} /><button className="secondary-button" type="button" onClick={exportHistory}>Exportar XLSX</button></div>
    <div className="card table-card" tabIndex={0} aria-label="Saldos pendentes"><h2>Saldo acumulado pendente</h2>
      {loading ? <div className="skeleton-list"><div className="skeleton" /><div className="skeleton" /></div> : null}
      {!loading ? <table><thead><tr><th>Chatter</th><th>Saldo pendente</th><th>Ações</th></tr></thead><tbody>{chatters.map((chatter) => <tr key={chatter.id}><td>{chatter.displayName}</td><td>{chatter.pendingFormatted} {chatter.pendingCents > 0 ? <span className="status-badge pending">Pendente</span> : <span className="status-badge paid">Pago</span>}</td><td>{chatter.pendingCents > 0 ? <button className="primary-button" onClick={() => setPayTarget(chatter)}>Pagar</button> : <span className="status-badge paid">Sem saldo</span>}</td></tr>)}</tbody></table> : null}
      {!loading && chatters.length === 0 ? <p className="empty-hint">Nenhum chatter encontrado.</p> : null}{renderPagination(balancePagination, "balancePage")}
    </div>
    <div className="card table-card" tabIndex={0} aria-label="Histórico de pagamentos"><h2>Histórico de pagamentos</h2>
      {!loading ? <table><thead><tr><th>Data</th><th>Chatter</th><th>Valor pago</th><th>Gerente</th></tr></thead><tbody>{history.map((record) => <tr key={record.id}><td>{formatDateTime(record.paidAt)}</td><td>{record.chatter.displayName}</td><td>{record.totalFormatted}</td><td>{record.manager.displayName}</td></tr>)}</tbody></table> : null}
      {!loading && history.length === 0 ? <p className="empty-hint">Nenhum pagamento registrado.</p> : null}{renderPagination(historyPagination, "historyPage")}
    </div>
    <ModalDialog open={Boolean(payTarget)} onClose={() => setPayTarget(null)} ariaLabel="Confirmar pagamento">
      {payTarget ? <><h2>Confirmar pagamento</h2><p>Confirma o pagamento de <strong>{payTarget.pendingFormatted}</strong> para <strong>{payTarget.displayName}</strong>?</p><div className="modal-actions"><button className="secondary-button" onClick={() => setPayTarget(null)} disabled={paying}>Cancelar</button><button className="primary-button" onClick={() => void confirmPay()} disabled={paying}>{paying ? "Registrando..." : "Confirmar pagamento"}</button></div></> : null}
    </ModalDialog>
    {error ? <div className="error-box">{error}</div> : null}
  </section>;
};

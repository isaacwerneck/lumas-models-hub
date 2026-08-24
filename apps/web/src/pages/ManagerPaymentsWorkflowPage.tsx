import { useEffect, useRef, useState } from "react";
import { Eye, FileCheck2, Upload } from "lucide-react";
import type { Pagination } from "@lumas/contracts";
import { api, downloadApiFile } from "../lib/api";
import { useToast } from "../components/Toast";
import { getApiErrorMessage } from "../lib/apiError";
import { formatDateTime } from "../lib/dateTime";
import { ModalDialog } from "../components/ModalDialog";

type Balance = { id: string; displayName: string; isActive: boolean; pendingCents: number; pendingFormatted: string; verifiedCents: number; verifiedFormatted: string; payableCents: number; payableFormatted: string; blockedCents: number; blockedFormatted: string; payableEarningIds: string[] };
type Receipt = { id: string; originalName: string; mimeType: string; sizeBytes: number };
type Payment = { id: string; chatter: { displayName: string }; manager: { displayName: string }; totalFormatted: string; paidAt: string; receipt?: Receipt | null };
type Tag = { id: string; name: string };
type ImportSummary = { id: string; originalName: string; vendorName: string; createdAt: string; totalCommissionCents: number; modelTag: Tag };
type Result = { id: string; status: "MATCHED" | "MISMATCH" | "OUT_OF_RANGE" | "AMBIGUOUS" | "OVERRIDDEN"; statementCommissionCents: number; reportedGrossCents: number; deltaCents: number; shift: { startedAt: string; endedAt: string; chatter: { displayName: string } } };
type ImportDetail = ImportSummary & { reconciliations: Result[] };
const emptyPagination: Pagination = { page: 1, pageSize: 20, total: 0, totalPages: 1 };
const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
const today = () => new Date().toISOString().slice(0, 10);

const ReceiptButton = ({ receipt }: { receipt: Receipt }) => {
  const toast = useToast();
  const open = async () => {
    try {
      const response = await api.get(`/payment-receipts/${receipt.id}/content`, { responseType: "blob" });
      const url = URL.createObjectURL(response.data); window.open(url, "_blank", "noopener,noreferrer"); window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) { toast.error(getApiErrorMessage(error, "Não foi possível abrir o comprovante.")); }
  };
  return <button className="evidence-link" onClick={() => void open()}><Eye size={15} /> {receipt.originalName}</button>;
};

export const ManagerPaymentsWorkflowPage = () => {
  const toast = useToast();
  const [balances, setBalances] = useState<Balance[]>([]);
  const [history, setHistory] = useState<Payment[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [imports, setImports] = useState<ImportSummary[]>([]);
  const [pagination, setPagination] = useState<Pagination>(emptyPagination);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [payTarget, setPayTarget] = useState<Balance | null>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [paying, setPaying] = useState(false);
  const [statementFile, setStatementFile] = useState<File | null>(null);
  const statementInputRef = useRef<HTMLInputElement>(null);
  const [modelTagId, setModelTagId] = useState("");
  const [coverageStart, setCoverageStart] = useState(today());
  const [coverageEnd, setCoverageEnd] = useState(today());
  const [importing, setImporting] = useState(false);
  const [importDetail, setImportDetail] = useState<ImportDetail | null>(null);
  const [overrideTarget, setOverrideTarget] = useState<Result | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const [balanceResponse, historyResponse, tagResponse, importResponse] = await Promise.all([
        api.get("/manager/payments/balances", { params: { page, pageSize: 20, search: search || undefined } }),
        api.get("/manager/payments/history", { params: { page: 1, pageSize: 50 } }),
        api.get("/manager/tags", { params: { page: 1, pageSize: 100 } }),
        api.get("/manager/reconciliations/imports")
      ]);
      setBalances(balanceResponse.data.items); setPagination(balanceResponse.data.pagination); setHistory(historyResponse.data.items);
      const nextTags = tagResponse.data.items ?? tagResponse.data.tags ?? []; setTags(nextTags); setModelTagId((current) => current || nextTags[0]?.id || ""); setImports(importResponse.data.items);
    } catch (requestError) { setError(getApiErrorMessage(requestError, "Erro ao carregar pagamentos.")); }
    finally { setLoading(false); }
  };
  useEffect(() => { const timer = window.setTimeout(() => void load(), 250); return () => window.clearTimeout(timer); }, [page, search]);

  const importStatement = async () => {
    if (!statementFile || !modelTagId) return; setImporting(true);
    try {
      const form = new FormData(); form.append("file", statementFile);
      await api.post("/manager/reconciliations/import", form, { params: { modelTagId, coverageStart, coverageEnd } });
      setStatementFile(null); if (statementInputRef.current) statementInputRef.current.value = ""; await load(); toast.success("Extrato importado e horários conferidos.");
    } catch (error) { toast.error(getApiErrorMessage(error, "Não foi possível conferir o extrato.")); }
    finally { setImporting(false); }
  };
  const openImport = async (item: ImportSummary) => {
    try { setImportDetail((await api.get(`/manager/reconciliations/imports/${item.id}`)).data.item); }
    catch (error) { toast.error(getApiErrorMessage(error, "Não foi possível abrir a conferência.")); }
  };
  const override = async () => {
    if (!overrideTarget || overrideReason.trim().length < 10) return;
    try {
      await api.post(`/manager/reconciliations/results/${overrideTarget.id}/override`, { reason: overrideReason.trim() });
      setOverrideTarget(null); setOverrideReason(""); if (importDetail) await openImport(importDetail); await load(); toast.success("Exceção auditada e horário liberado.");
    } catch (error) { toast.error(getApiErrorMessage(error, "Não foi possível liberar a divergência.")); }
  };
  const pay = async () => {
    if (!payTarget) return; setPaying(true);
    try {
      let receiptId: string | undefined;
      if (receiptFile) { const form = new FormData(); form.append("file", receiptFile); receiptId = (await api.post("/manager/payment-receipts", form)).data.receipt.id; }
      await api.post("/manager/payments/pay", { chatterId: payTarget.id, earningIds: payTarget.payableEarningIds, expectedTotalCents: payTarget.payableCents, ...(receiptId ? { receiptId } : {}) }, { headers: { "Idempotency-Key": crypto.randomUUID() } });
      setPayTarget(null); setReceiptFile(null); await load(); toast.success("Pagamento registrado. As capturas dos horários pagos entrarão em limpeza segura.");
    } catch (error) { toast.error(getApiErrorMessage(error, "Não foi possível registrar o pagamento.")); }
    finally { setPaying(false); }
  };

  const closePaymentModal = () => {
    setPayTarget(null);
    setReceiptFile(null);
  };

  return <section className="stack-gap payments-page">
    <div className="page-header"><div><h1>Pagamentos</h1><p>Acompanhe as confirmações e pague os horários liberados pelo chatter. A conferência do extrato é opcional.</p></div></div>
    <div className="card reconciliation-upload"><div className="reconciliation-heading"><span className="eyebrow"><FileCheck2 size={16} /> Conferência financeira</span><h2>Importar SalesStatement</h2></div><div className="reconciliation-fields">
      <label className="reconciliation-field model-field">Modelo<select value={modelTagId} onChange={(event) => setModelTagId(event.target.value)}>{tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></label>
      <label className="reconciliation-field start-field">Início<input type="date" value={coverageStart} onChange={(event) => setCoverageStart(event.target.value)} /></label><label className="reconciliation-field end-field">Fim<input type="date" value={coverageEnd} onChange={(event) => setCoverageEnd(event.target.value)} /></label>
      <label className="file-control statement-file-control"><span>Arquivo XLSX</span><span className={`file-picker-shell${statementFile ? " has-file" : ""}`}><span className="file-picker-action"><Upload size={15} /> Escolher arquivo</span><span className="file-picker-name" title={statementFile?.name}>{statementFile?.name ?? "Nenhum arquivo selecionado"}</span><input ref={statementInputRef} type="file" accept=".xlsx" aria-label="Selecionar arquivo XLSX" onChange={(event) => setStatementFile(event.target.files?.[0] ?? null)} /></span></label>
      <button className="primary-button reconciliation-submit" disabled={!statementFile || !modelTagId || importing} onClick={() => void importStatement()}><Upload size={16} /> {importing ? "Conferindo…" : "Conferir valores"}</button>
    </div>{imports.length ? <div className="import-list">{imports.slice(0, 5).map((item) => <button className="import-row" key={item.id} onClick={() => void openImport(item)}><span><strong>{item.modelTag.name}</strong><small>{item.originalName} · {formatDateTime(item.createdAt)}</small></span><span>{money(item.totalCommissionCents)} <Eye size={16} /></span></button>)}</div> : null}</div>

    <div className="card list-toolbar"><input className="search-input" type="search" placeholder="Buscar chatter…" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /><button className="secondary-button" onClick={() => void downloadApiFile("/manager/reports/payments.xlsx", `pagamentos-${today()}.xlsx`)}>Exportar histórico</button></div>
    <div className="payment-balance-grid">{loading ? <div className="card skeleton-list"><div className="skeleton" /><div className="skeleton" /></div> : balances.map((item) => <article className="card payment-balance-card" key={item.id}><div className="payment-card-title"><div><h3>{item.displayName}</h3><small>{item.isActive ? "Ativo" : "Inativo"}</small></div><span className={`status-badge ${item.payableCents ? "paid" : "pending"}`}>{item.payableCents ? "Liberado" : "Aguardando"}</span></div><dl><div><dt>Total pendente</dt><dd>{item.pendingFormatted}</dd></div><div><dt>Confirmado pelo chatter</dt><dd>{item.verifiedFormatted}</dd></div><div><dt>Liberado para pagamento</dt><dd>{item.payableFormatted}</dd></div>{item.blockedCents ? <div className="blocked"><dt>Com divergência no extrato</dt><dd>{item.blockedFormatted}</dd></div> : null}</dl><button className="primary-button" disabled={!item.payableCents} onClick={() => setPayTarget(item)}>Pagar {item.payableFormatted}</button></article>)}</div>
    {pagination.totalPages > 1 ? <div className="pagination"><button disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button><span>Página {page} de {pagination.totalPages}</span><button disabled={page >= pagination.totalPages} onClick={() => setPage(page + 1)}>Próxima</button></div> : null}
    <div className="card table-card"><h2>Histórico de pagamentos</h2>{loading ? <div className="skeleton-list" aria-label="Carregando histórico"><div className="skeleton" /><div className="skeleton" /></div> : <table><thead><tr><th>Data</th><th>Chatter</th><th>Valor</th><th>Gerente</th><th>Comprovante</th></tr></thead><tbody>{history.map((item) => <tr key={item.id}><td>{formatDateTime(item.paidAt)}</td><td>{item.chatter.displayName}</td><td>{item.totalFormatted}</td><td>{item.manager.displayName}</td><td>{item.receipt ? <ReceiptButton receipt={item.receipt} /> : "—"}</td></tr>)}</tbody></table>}{!loading && history.length === 0 ? <p className="empty-hint">Nenhum pagamento registrado.</p> : null}</div>

    <ModalDialog open={Boolean(payTarget)} onClose={closePaymentModal} ariaLabel="Confirmar pagamento" panelClassName="payment-confirmation-modal">{payTarget ? <><h2>Confirmar pagamento</h2><p className="payment-confirmation-summary"><strong>{payTarget.payableFormatted}</strong> em {payTarget.payableEarningIds.length} horário(s) confirmado(s) por <strong>{payTarget.displayName}</strong>.</p><label className="file-control payment-receipt-field"><span>Comprovante <small className="optional-label">Opcional</small></span><span className={`file-picker-shell${receiptFile ? " has-file" : ""}`}><span className="file-picker-action"><Upload size={15} /> Escolher arquivo</span><span className="file-picker-name" title={receiptFile?.name}>{receiptFile?.name ?? "Nenhum arquivo selecionado"}</span><input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" aria-label="Selecionar comprovante do pagamento" onChange={(event) => setReceiptFile(event.target.files?.[0] ?? null)} /></span><small className="file-picker-hint">PDF, PNG, JPG ou WebP · até 10 MB</small></label><div className="modal-actions"><button className="secondary-button" onClick={closePaymentModal} disabled={paying}>Cancelar</button><button className="primary-button" disabled={paying} onClick={() => void pay()}>{paying ? "Registrando…" : "Confirmar pagamento"}</button></div></> : null}</ModalDialog>
    <ModalDialog open={Boolean(importDetail)} onClose={() => setImportDetail(null)} ariaLabel="Resultado da conferência" panelClassName="reconciliation-modal">{importDetail ? <><h2>Resultado da conferência</h2><p>{importDetail.modelTag.name} · {importDetail.vendorName}</p><div className="reconciliation-results">{importDetail.reconciliations.map((item) => <article className={`reconciliation-result status-${item.status.toLowerCase()}`} key={item.id}><div><strong>{item.shift.chatter.displayName}</strong><small>{formatDateTime(item.shift.startedAt)} — {formatDateTime(item.shift.endedAt)}</small></div><div><span>Informado {money(item.reportedGrossCents)}</span><span>Extrato {money(item.statementCommissionCents)}</span><strong>Diferença {money(item.deltaCents)}</strong></div><span className="status-badge">{item.status}</span>{item.status !== "MATCHED" && item.status !== "OVERRIDDEN" ? <button className="secondary-button" onClick={() => setOverrideTarget(item)}>Liberar com justificativa</button> : null}</article>)}</div></> : null}</ModalDialog>
    <ModalDialog open={Boolean(overrideTarget)} onClose={() => setOverrideTarget(null)} ariaLabel="Liberar divergência"><h2>Liberar divergência</h2><p>A exceção ficará registrada na auditoria.</p><label>Justificativa<textarea value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} maxLength={500} /></label><div className="modal-actions"><button className="secondary-button" onClick={() => setOverrideTarget(null)}>Cancelar</button><button className="primary-button" disabled={overrideReason.trim().length < 10} onClick={() => void override()}>Registrar e liberar</button></div></ModalDialog>
    {error ? <div className="error-box">{error}</div> : null}
  </section>;
};

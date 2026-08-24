import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Eye } from "lucide-react";
import type { AuditLogDto, Pagination } from "@lumas/contracts";
import { api } from "../lib/api";
import { getApiErrorMessage } from "../lib/apiError";

const ACTIONS = ["LOGIN", "LOGIN_FAILED", "ACCOUNT_LOCKED", "LOGOUT", "PASSWORD_CHANGED", "PASSWORD_RESET", "SESSIONS_REVOKED", "USER_CREATED", "USER_UPDATED", "TAG_CREATED", "TAG_UPDATED", "TAG_DELETED", "CHATTER_MODEL_TAGS_UPDATED", "SHIFT_STARTED", "SHIFT_CLOSED", "SHIFT_UPDATED", "SHIFT_NOTES_UPDATED", "SHIFT_DELETED", "PAYMENT_MADE", "EVIDENCE_UPLOADED", "EVIDENCE_PURGED"];
const actionLabels: Record<string, string> = {
  LOGIN: "Entrou no sistema", LOGIN_FAILED: "Tentativa de login falhou", ACCOUNT_LOCKED: "Conta bloqueada",
  LOGOUT: "Saiu do sistema", PASSWORD_CHANGED: "Alterou a senha", PASSWORD_RESET: "Senha temporária criada",
  SESSIONS_REVOKED: "Sessões encerradas", USER_CREATED: "Usuário criado", USER_UPDATED: "Usuário atualizado",
  TAG_CREATED: "Modelo criado", TAG_UPDATED: "Modelo atualizado", TAG_DELETED: "Modelo excluído",
  CHATTER_MODEL_TAGS_UPDATED: "Modelos atribuídos", SHIFT_STARTED: "Turno iniciado", SHIFT_CLOSED: "Turno encerrado",
  SHIFT_UPDATED: "Turno atualizado", SHIFT_NOTES_UPDATED: "Observação atualizada", SHIFT_DELETED: "Turno excluído",
  PAYMENT_MADE: "Pagamento registrado", EVIDENCE_UPLOADED: "Comprovante enviado", EVIDENCE_PURGED: "Comprovante removido"
};

export const ManagerAuditPage = () => {
  const [params, setParams] = useSearchParams();
  const page = Number(params.get("page") ?? 1);
  const action = params.get("action") ?? "";
  const user = params.get("user") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const [items, setItems] = useState<AuditLogDto[]>([]);
  const [userInput, setUserInput] = useState(user);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 20, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AuditLogDto | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (userInput === user) return;
      const next = new URLSearchParams(params);
      next.set("page", "1");
      if (userInput) next.set("user", userInput); else next.delete("user");
      setParams(next);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [userInput, user]);

  useEffect(() => {
    setLoading(true);
    api.get("/manager/audit-logs", { params: {
      page, pageSize: 20, action: action || undefined, user: user || undefined,
      from: from ? `${from}T00:00:00-03:00` : undefined,
      to: to ? `${to}T23:59:59.999-03:00` : undefined
    } })
      .then((response) => { setItems(response.data.items); setPagination(response.data.pagination); setError(null); })
      .catch((requestError: unknown) => setError(getApiErrorMessage(requestError, "Erro ao carregar auditoria.")))
      .finally(() => setLoading(false));
  }, [page, action, user, from, to]);

  const navigate = (changes: Record<string, string | number>) => {
    const next = new URLSearchParams(params);
    Object.entries(changes).forEach(([key, value]) => value ? next.set(key, String(value)) : next.delete(key));
    setParams(next);
  };

  return <section className="stack-gap">
    <div className="page-header"><div><h1>Auditoria</h1><p>Histórico de ações sensíveis do sistema</p></div></div>
    <div className="card list-toolbar">
      <label>Ação <select value={action} onChange={(event) => navigate({ page: 1, action: event.target.value })}><option value="">Todas</option>{ACTIONS.map((value) => <option key={value} value={value}>{actionLabels[value] ?? value}</option>)}</select></label>
      <label>Usuário <input value={userInput} placeholder="Nome ou login" onChange={(event) => setUserInput(event.target.value)} /></label>
      <label>De <input type="date" value={from} onChange={(event) => navigate({ page: 1, from: event.target.value })} /></label>
      <label>Até <input type="date" value={to} onChange={(event) => navigate({ page: 1, to: event.target.value })} /></label>
      <span className="list-count">{pagination.total} registros</span>
    </div>
    <div className="card table-card" tabIndex={0} aria-label="Registros de auditoria">
      {loading ? <div className="skeleton-list"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div> : null}
      {!loading ? <table><thead><tr><th>Data</th><th>Ação</th><th>Responsável</th><th>Área</th><th><span className="visually-hidden">Ações</span></th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td>{new Date(item.createdAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td><td><span className="status-badge">{actionLabels[item.action] ?? item.action}</span></td><td>{item.actor?.displayName ?? "Sistema"}</td><td>{item.targetType}</td><td className="audit-actions-cell"><button type="button" className="audit-details-button" onClick={() => setSelected(item)} aria-label={`Ver detalhes de ${actionLabels[item.action] ?? item.action}`}><Eye size={15} aria-hidden="true" /><span>Ver detalhes</span></button></td></tr>)}</tbody></table> : null}
      {!loading && items.length === 0 ? <p className="empty-hint">Nenhum evento encontrado com este filtro.</p> : null}
      {pagination.totalPages > 1 ? <div className="pagination"><button className="secondary-button" disabled={page <= 1} onClick={() => navigate({ page: page - 1 })}>Anterior</button><span>Página {page} de {pagination.totalPages}</span><button className="secondary-button" disabled={page >= pagination.totalPages} onClick={() => navigate({ page: page + 1 })}>Próxima</button></div> : null}
    </div>{error ? <div className="error-box">{error}</div> : null}
    {selected ? <div className="shell-drawer-backdrop" role="presentation" onMouseDown={() => setSelected(null)}><aside className="audit-drawer" role="dialog" aria-modal="true" aria-label="Detalhes do evento" onMouseDown={(event) => event.stopPropagation()}><div className="drawer-heading"><div><span className="shell-eyebrow">Evento de auditoria</span><h2>{actionLabels[selected.action] ?? selected.action}</h2></div><button className="icon-button" onClick={() => setSelected(null)} aria-label="Fechar">×</button></div><dl className="audit-details"><div><dt>Data</dt><dd>{new Date(selected.createdAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</dd></div><div><dt>Responsável</dt><dd>{selected.actor?.displayName ?? "Sistema"}{selected.actor ? ` (@${selected.actor.username})` : ""}</dd></div><div><dt>Tipo de registro</dt><dd>{selected.targetType}</dd></div>{selected.targetId ? <div><dt>Identificador</dt><dd><code>{selected.targetId}</code></dd></div> : null}</dl><h3>Dados técnicos</h3><pre className="audit-metadata">{selected.metadata ? JSON.stringify(selected.metadata, null, 2) : "Nenhum dado adicional."}</pre></aside></div> : null}
  </section>;
};

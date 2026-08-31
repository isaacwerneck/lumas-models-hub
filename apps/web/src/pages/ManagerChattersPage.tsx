import { Fragment, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Eye, UserRoundCheck, UserRoundX } from "lucide-react";
import type { ChatterListItem, Pagination } from "@lumas/contracts";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";
import { getApiErrorMessage } from "../lib/apiError";
import { ManagerTagsPage } from "./ManagerTagsPage";
import { ModalDialog } from "../components/ModalDialog";

export const ManagerChattersPage = () => {
  const [chatters, setChatters] = useState<ChatterListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [params, setParams] = useSearchParams();
  const section = params.get("section") === "tags" ? "tags" : "team";
  const search = params.get("search") ?? "";
  const page = Number(params.get("page") ?? 1);
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 20, total: 0, totalPages: 1 });
  const toast = useToast();

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const loadChatters = async () => {
    setLoading(true);
    const response = await api.get("/manager/chatters", { params: { page, pageSize: 20, search: debouncedSearch || undefined } });
    setChatters(response.data.items);
    setPagination(response.data.pagination);
    setError(null);
    setLoading(false);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (section !== "team") return;
    void loadChatters()
      .catch((requestError: unknown) => {
        setError(getApiErrorMessage(requestError, "Erro ao carregar chatters."));
      })
      .finally(() => setLoading(false));
  }, [debouncedSearch, page, section]);

  const createChatter = async (event: FormEvent) => {
    event.preventDefault();

    const trimmedName = name.trim();
    if (trimmedName.length < 3) {
      toast.error("O nome precisa ter pelo menos 3 caracteres.");
      return;
    }

    try {
      await api.post("/manager/users", {
        username: trimmedName.toLowerCase(),
        displayName: trimmedName,
        role: "CHATTER",
        password,
        isActive: true
      });

      setName("");
      setPassword("");
      await loadChatters();
      toast.success("Chatter criado com sucesso.");
      setCreateOpen(false);
    } catch (requestError: unknown) {
      const message = getApiErrorMessage(requestError, "Falha ao criar chatter.", true);
      toast.error(message);
    }
  };

  const toggleActive = async (chatter: ChatterListItem) => {
    try {
      await api.patch(`/manager/users/${chatter.id}`, {
        isActive: !chatter.isActive
      });
      await loadChatters();
      toast.success(chatter.isActive ? "Chatter desativado." : "Chatter ativado.");
    } catch (requestError: unknown) {
      toast.error(getApiErrorMessage(requestError, "Não foi possível atualizar o chatter."));
    }
  };

  return (
    <section className="stack-gap">
      <div className="page-header">
        <div>
          <h1>Chatters</h1>
          <p>Gerencie a equipe, os acessos e as tags</p>
        </div>
      </div>
      <div className="segmented manager-section-tabs" role="tablist" aria-label="Gerenciamento de chatters">
        <button
          type="button"
          role="tab"
          className={section === "team" ? "active" : ""}
          aria-selected={section === "team"}
          aria-controls="manager-chatters-panel"
          onClick={() => setParams({})}
        >
          Equipe
        </button>
        <button
          type="button"
          role="tab"
          className={section === "tags" ? "active" : ""}
          aria-selected={section === "tags"}
          aria-controls="manager-tags-panel"
          onClick={() => setParams({ section: "tags" })}
        >
          Tags e vínculos
        </button>
      </div>

      {section === "tags" ? (
        <div id="manager-tags-panel" role="tabpanel">
          <ManagerTagsPage embedded />
        </div>
      ) : (
        <div id="manager-chatters-panel" className="stack-gap" role="tabpanel">
      <div className="list-action-row"><button className="primary-button" type="button" onClick={() => setCreateOpen(true)}>Novo chatter</button></div>

      <ModalDialog open={createOpen} onClose={() => setCreateOpen(false)} ariaLabel="Criar chatter">
        <form className="form-grid" onSubmit={createChatter}>
          <h2>Novo chatter</h2>
          <p>Crie o acesso com uma senha temporária. A troca será obrigatória no primeiro login.</p>
          <label>Nome do chatter<input value={name} onChange={(event) => setName(event.target.value)} minLength={3} maxLength={100} autoFocus required /><small className="field-hint">Também será usado como login, em minúsculas.</small></label>
          <label>Senha temporária<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} maxLength={128} autoComplete="new-password" required /><small className="field-hint">Use pelo menos 8 caracteres.</small></label>
          <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setCreateOpen(false)}>Cancelar</button><button className="primary-button" type="submit">Criar chatter</button></div>
        </form>
      </ModalDialog>

      <div className="card table-card" tabIndex={0} aria-label="Tabela de chatters">
        <h2>Chatters</h2>
        <div className="list-toolbar">
          <input
            type="search"
            placeholder="Buscar por nome..."
            value={search}
            onChange={(event) => setParams({ search: event.target.value, page: "1" })}
            className="search-input"
          />
          <span className="list-count">
            {pagination.total} {pagination.total === 1 ? "chatter" : "chatters"}
          </span>
        </div>
        {loading ? (
          <div className="skeleton-list">
            <div className="skeleton" />
            <div className="skeleton" />
            <div className="skeleton" />
          </div>
        ) : (
          <div className="chatter-table">
            <span className="cell head">Usuario</span>
            <span className="cell head">Total líquido</span>
            <span className="cell head right">Status</span>
            <span className="cell head center">Acoes</span>
            {chatters.map((chatter) => (
              <Fragment key={chatter.id}>
                <span className="cell name">{chatter.displayName}</span>
                <span className="cell">{chatter.totalPayoutFormatted}</span>
                <span className="cell right">
                  <span className={chatter.isActive ? "status-badge paid" : "status-badge"}>
                    {chatter.isActive ? "Ativo" : "Inativo"}
                  </span>
                </span>
                <span className="cell center chatter-row-actions">
                  <Link
                    to={`/chatters/${chatter.id}`}
                    className="chatter-action-button is-details"
                    aria-label={`Ver detalhes de ${chatter.displayName}`}
                  >
                    <Eye size={15} aria-hidden="true" />
                    <span>Detalhes</span>
                  </Link>
                  <button
                    type="button"
                    className={`chatter-action-button ${chatter.isActive ? "is-danger" : "is-activate"}`}
                    onClick={() => void toggleActive(chatter)}
                    aria-label={`${chatter.isActive ? "Desativar" : "Ativar"} ${chatter.displayName}`}
                  >
                    {chatter.isActive
                      ? <UserRoundX size={15} aria-hidden="true" />
                      : <UserRoundCheck size={15} aria-hidden="true" />}
                    <span>{chatter.isActive ? "Desativar" : "Ativar"}</span>
                  </button>
                </span>
              </Fragment>
            ))}
            {!loading && chatters.length === 0 ? (
              <p className="empty-hint">{search ? "Nenhum chatter encontrado com essa busca." : "Nenhum chatter cadastrado."}</p>
            ) : null}
          </div>
        )}
        {pagination.totalPages > 1 ? <div className="pagination">
          <button className="secondary-button" disabled={pagination.page <= 1} onClick={() => setParams({ search, page: String(page - 1) })}>Anterior</button>
          <span>Página {pagination.page} de {pagination.totalPages}</span>
          <button className="secondary-button" disabled={pagination.page >= pagination.totalPages} onClick={() => setParams({ search, page: String(page + 1) })}>Próxima</button>
        </div> : null}
      </div>

      {error ? <div className="error-box">{error}</div> : null}
        </div>
      )}
    </section>
  );
};

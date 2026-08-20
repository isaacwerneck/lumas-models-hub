import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";
import { getApiErrorMessage } from "../lib/apiError";
import { ModalDialog } from "../components/ModalDialog";

type ModelTag = { id: string; name: string; isActive: boolean; chatterCount?: number };
type TagChatter = { id: string; displayName: string; modelTags: Array<{ id: string; name: string }> };

export const ManagerTagsPage = ({ embedded = false }: { embedded?: boolean }) => {
  const [tags, setTags] = useState<ModelTag[]>([]);
  const [chatters, setChatters] = useState<TagChatter[]>([]);
  const [tagName, setTagName] = useState("");
  const [targetChatterId, setTargetChatterId] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingTags, setSavingTags] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const toast = useToast();
  const savedTagIds = (chatters.find((chatter) => chatter.id === targetChatterId)?.modelTags ?? []).map((tag) => tag.id);
  const tagsDirty = selectedTags.length !== savedTagIds.length || selectedTags.some((id) => !savedTagIds.includes(id));

  const loadData = async () => {
    const [tagsResponse, chattersResponse] = await Promise.all([
      api.get<{ tags: ModelTag[] }>("/manager/tags"),
      api.get<{ chatters: TagChatter[] }>("/manager/chatters", { params: { page: 1, pageSize: 100 } })
    ]);

    setTags(tagsResponse.data.tags);
    setChatters(chattersResponse.data.chatters);

    if (!targetChatterId && chattersResponse.data.chatters.length) {
      const chatter = chattersResponse.data.chatters[0];
      setTargetChatterId(chatter.id);
      setSelectedTags((chatter.modelTags ?? []).map((item) => item.id));
    }
    setLoading(false);
  };

  useEffect(() => {
    void loadData();
  }, []);

  const createTag = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await api.post("/manager/tags", { name: tagName });
      setTagName("");
      await loadData();
      toast.success("Tag criada com sucesso.");
    } catch (requestError: unknown) {
      toast.error(getApiErrorMessage(requestError, "Não foi possível criar a tag."));
    }
  };

  const onSelectChatter = (chatterId: string) => {
    setTargetChatterId(chatterId);
    const chatter = chatters.find((item) => item.id === chatterId);
    setSelectedTags((chatter?.modelTags ?? []).map((item) => item.id));
  };

  const toggleTag = (id: string) => {
    setSelectedTags((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
    );
  };

  const saveTags = async () => {
    if (!targetChatterId) {
      return;
    }

    setSavingTags(true);
    try {
      await api.put(`/manager/chatters/${targetChatterId}/tags`, { modelTagIds: selectedTags });
      await loadData();
      toast.success("Vínculos atualizados.");
    } catch (requestError: unknown) {
      toast.error(getApiErrorMessage(requestError, "Não foi possível atualizar os vínculos."));
    } finally {
      setSavingTags(false);
    }
  };

  const deleteTag = async () => {
    if (!deleteTarget) return;
    try {
      await api.delete(`/manager/tags/${deleteTarget.id}`);
      setDeleteTarget(null);
      await loadData();
      toast.success("Tag excluída.");
    } catch (requestError: unknown) {
      toast.error(getApiErrorMessage(requestError, "Não foi possível excluir a tag."));
    }
  };

  return (
    <section className={embedded ? "stack-gap manager-tags-panel" : "stack-gap"}>
      {!embedded ? (
        <div className="page-header">
          <div>
            <h1>Tags</h1>
            <p>Gerencie as tags de conteúdo</p>
          </div>
        </div>
      ) : null}
      <form className="card form-grid" onSubmit={createTag}>
        <h2>Nova tag de modelo</h2>
        <label>
          Nome da tag
          <input value={tagName} onChange={(event) => setTagName(event.target.value)} required />
        </label>
        <button className="primary-button" type="submit" disabled={!tagName.trim()}>
          Criar tag
        </button>
      </form>

      <div className="card table-card" tabIndex={0} aria-label="Tags existentes">
        <h2>Tags existentes</h2>
        {loading ? <div className="skeleton-list"><div className="skeleton" /><div className="skeleton" /></div> : null}
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Chatters vinculados</th>
              <th>Acoes</th>
            </tr>
          </thead>
          <tbody>
            {!loading && tags.map((tag) => (
              <tr key={tag.id}>
                <td>{tag.name}</td>
                <td>{tag.chatterCount ?? 0}</td>
                <td className="actions-cell">
                  <button className="secondary-button" onClick={() => setDeleteTarget({ id: tag.id, name: tag.name })}>
                    Apagar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && tags.length === 0 ? <p className="empty-hint">Nenhuma tag cadastrada. Crie a primeira acima.</p> : null}
      </div>
      <ModalDialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} ariaLabel="Excluir tag">
        {deleteTarget ? <>
        <h2>Excluir tag</h2><p>Tem certeza que deseja excluir <strong>{deleteTarget.name}</strong>?</p>
        <div className="modal-actions"><button className="secondary-button" onClick={() => setDeleteTarget(null)}>Cancelar</button><button className="danger-button" onClick={() => void deleteTag()}>Excluir tag</button></div>
        </> : null}
      </ModalDialog>

      <div className="card form-grid">
        <h2>Vincular tags a chatter</h2>
        <label>
          Chatter
          <select value={targetChatterId} onChange={(event) => onSelectChatter(event.target.value)}>
            {chatters.map((chatter) => (
              <option key={chatter.id} value={chatter.id}>
                {chatter.displayName}
              </option>
            ))}
          </select>
        </label>

        <div className="tag-cloud">
          {tags.map((tag) => {
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

        <button className="primary-button" type="button" onClick={saveTags} disabled={!targetChatterId || !tagsDirty || savingTags}>
          {savingTags ? "Salvando..." : "Salvar vínculos"}
        </button>
      </div>
    </section>
  );
};

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../lib/api";

export const ManagerTagsPage = () => {
  const [tags, setTags] = useState<any[]>([]);
  const [chatters, setChatters] = useState<any[]>([]);
  const [tagName, setTagName] = useState("");
  const [targetChatterId, setTargetChatterId] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  const loadData = async () => {
    const [tagsResponse, chattersResponse] = await Promise.all([
      api.get("/manager/tags"),
      api.get("/manager/chatters")
    ]);

    setTags(tagsResponse.data.tags);
    setChatters(chattersResponse.data.chatters);

    if (!targetChatterId && chattersResponse.data.chatters.length) {
      const chatter = chattersResponse.data.chatters[0];
      setTargetChatterId(chatter.id);
      setSelectedTags((chatter.modelTags ?? []).map((item: any) => item.id));
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const createTag = async (event: FormEvent) => {
    event.preventDefault();
    await api.post("/manager/tags", { name: tagName });
    setTagName("");
    await loadData();
  };

  const onSelectChatter = (chatterId: string) => {
    setTargetChatterId(chatterId);
    const chatter = chatters.find((item) => item.id === chatterId);
    setSelectedTags((chatter?.modelTags ?? []).map((item: any) => item.id));
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

    await api.put(`/manager/chatters/${targetChatterId}/tags`, {
      modelTagIds: selectedTags
    });

    await loadData();
  };

  return (
    <section className="stack-gap">
      <form className="card form-grid" onSubmit={createTag}>
        <h2>Nova tag de modelo</h2>
        <label>
          Nome da tag
          <input value={tagName} onChange={(event) => setTagName(event.target.value)} required />
        </label>
        <button className="primary-button" type="submit">
          Criar tag
        </button>
      </form>

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

        <button className="primary-button" type="button" onClick={saveTags}>
          Salvar vinculos
        </button>
      </div>
    </section>
  );
};

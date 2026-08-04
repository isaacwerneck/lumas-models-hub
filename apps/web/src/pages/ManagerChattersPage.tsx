import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../lib/api";

export const ManagerChattersPage = () => {
  const [chatters, setChatters] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");

  const loadChatters = async () => {
    const response = await api.get("/manager/chatters");
    setChatters(response.data.chatters);
  };

  useEffect(() => {
    void loadChatters();
  }, []);

  const createChatter = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    try {
      await api.post("/manager/users", {
        username,
        displayName,
        role: "CHATTER",
        password,
        isActive: true
      });

      setUsername("");
      setDisplayName("");
      setPassword("");
      await loadChatters();
    } catch (requestError: any) {
      setError(requestError?.response?.data?.message ?? "Falha ao criar chatter.");
    }
  };

  const toggleActive = async (chatter: any) => {
    await api.patch(`/manager/users/${chatter.id}`, {
      isActive: !chatter.isActive
    });
    await loadChatters();
  };

  return (
    <section className="stack-gap">
      <form className="card form-grid" onSubmit={createChatter}>
        <h2>Novo chatter</h2>
        <label>
          Usuario
          <input value={username} onChange={(event) => setUsername(event.target.value)} required />
        </label>
        <label>
          Nome
          <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required />
        </label>
        <label>
          Senha inicial
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        <button className="primary-button" type="submit">
          Criar chatter
        </button>
      </form>

      <div className="card table-card">
        <h2>Chatters</h2>
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Usuario</th>
              <th>Total produzido</th>
              <th>Status</th>
              <th>Acoes</th>
            </tr>
          </thead>
          <tbody>
            {chatters.map((chatter) => (
              <tr key={chatter.id}>
                <td>{chatter.displayName}</td>
                <td>{chatter.username}</td>
                <td>{chatter.totalGrossFormatted}</td>
                <td>{chatter.isActive ? "Ativo" : "Inativo"}</td>
                <td>
                  <button className="secondary-button" onClick={() => void toggleActive(chatter)}>
                    {chatter.isActive ? "Desativar" : "Ativar"}
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
};

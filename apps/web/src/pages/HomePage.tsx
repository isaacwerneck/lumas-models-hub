import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../lib/api";
import { useAuth } from "../auth/AuthContext";

type Shift = {
  id: string;
  modelTagId: string;
  modelTag: { id: string; name: string };
};

type Room = { id: string; name: string };

export const HomePage = () => {
  const { user } = useAuth();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [currentShift, setCurrentShift] = useState<Shift | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);

  const [modelTagId, setModelTagId] = useState("");
  const [startImageUrl, setStartImageUrl] = useState("");
  const [startValue, setStartValue] = useState("");
  const [startConfidence, setStartConfidence] = useState("0.9");

  const [endImageUrl, setEndImageUrl] = useState("");
  const [endValue, setEndValue] = useState("");
  const [endConfidence, setEndConfidence] = useState("0.9");
  const [negativeJustification, setNegativeJustification] = useState("");

  const loadData = async () => {
    const [roomsResponse, shiftResponse] = await Promise.all([
      api.get("/chat/rooms"),
      api.get("/chatter/shifts/current")
    ]);

    setRooms(roomsResponse.data.rooms);
    setCurrentShift(shiftResponse.data.shift);

    if (!modelTagId && roomsResponse.data.rooms.length) {
      setModelTagId(roomsResponse.data.rooms[0].id);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  if (user?.role === "MANAGER") {
    return (
      <section className="card">
        <h2>Visao do gerente</h2>
        <p>Use Chatters, Tags e Pagamento para administrar a operacao.</p>
      </section>
    );
  }

  const startShift = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setStarting(true);

    try {
      const response = await api.post("/chatter/shifts/start", {
        modelTagId,
        startImageUrl,
        ocrDetectedValue: startValue,
        manualConfirmedValue: startValue,
        ocrConfidence: Number(startConfidence)
      });
      setCurrentShift(response.data.shift);
      setMessage(`Turno iniciado em ${response.data.shift.modelTag.name}.`);
    } catch (requestError: any) {
      setError(requestError?.response?.data?.message ?? "Nao foi possivel iniciar o turno.");
    } finally {
      setStarting(false);
    }
  };

  const endShift = async (event: FormEvent) => {
    event.preventDefault();
    if (!currentShift) {
      return;
    }

    setError(null);
    setMessage(null);
    setEnding(true);

    try {
      const response = await api.post(`/chatter/shifts/${currentShift.id}/end`, {
        endImageUrl,
        ocrDetectedValue: endValue,
        ocrConfidence: Number(endConfidence),
        negativeJustification: negativeJustification || undefined
      });

      setMessage(
        `Turno encerrado. Bruto: ${response.data.grossAmountFormatted} | Comissao: ${response.data.payoutAmountFormatted}`
      );
      setCurrentShift(null);
      setEndImageUrl("");
      setEndValue("");
      setNegativeJustification("");
    } catch (requestError: any) {
      setError(requestError?.response?.data?.message ?? "Nao foi possivel encerrar o turno.");
    } finally {
      setEnding(false);
    }
  };

  return (
    <section className="stack-gap">
      <div className="card">
        <h2>Status do turno</h2>
        <p>
          {currentShift
            ? `Turno aberto em ${currentShift.modelTag.name}.`
            : "Nenhum turno aberto no momento."}
        </p>
      </div>

      {!currentShift ? (
        <form className="card form-grid" onSubmit={startShift}>
          <h2>Iniciar turno</h2>

          <label>
            Modelo
            <select value={modelTagId} onChange={(e) => setModelTagId(e.target.value)} required>
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            URL da imagem inicial
            <input value={startImageUrl} onChange={(e) => setStartImageUrl(e.target.value)} required />
          </label>

          <label>
            Valor extraido
            <input
              value={startValue}
              onChange={(e) => setStartValue(e.target.value)}
              placeholder="R$ 1.234,56"
              required
            />
          </label>

          <label>
            Confianca OCR (0-1)
            <input value={startConfidence} onChange={(e) => setStartConfidence(e.target.value)} required />
          </label>

          <button className="primary-button" type="submit" disabled={starting}>
            {starting ? "Iniciando..." : "Iniciar periodo"}
          </button>
        </form>
      ) : (
        <form className="card form-grid" onSubmit={endShift}>
          <h2>Encerrar turno</h2>

          <label>
            URL da imagem final
            <input value={endImageUrl} onChange={(e) => setEndImageUrl(e.target.value)} required />
          </label>

          <label>
            Valor extraido
            <input
              value={endValue}
              onChange={(e) => setEndValue(e.target.value)}
              placeholder="R$ 1.450,00"
              required
            />
          </label>

          <label>
            Confianca OCR (0-1)
            <input value={endConfidence} onChange={(e) => setEndConfidence(e.target.value)} required />
          </label>

          <label>
            Justificativa para saldo negativo
            <textarea
              value={negativeJustification}
              onChange={(e) => setNegativeJustification(e.target.value)}
              placeholder="Obrigatorio apenas se saldo final for menor que o inicial."
            />
          </label>

          <button className="primary-button" type="submit" disabled={ending}>
            {ending ? "Encerrando..." : "Encerrar periodo"}
          </button>
        </form>
      )}

      {message ? <div className="success-box">{message}</div> : null}
      {error ? <div className="error-box">{error}</div> : null}
    </section>
  );
};

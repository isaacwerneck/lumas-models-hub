import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../lib/api";
import { useAuth } from "../auth/AuthContext";

type Shift = {
  id: string;
  modelTagId: string;
  modelTag: { id: string; name: string };
};

type Room = { id: string; name: string };

type OcrExtractResponse = {
  confidence: number;
  detectedValue: string | null;
  rawText: string;
};

type FxRateResponse = {
  rate: number;
};

const toDateTimeLocalValue = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
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

const parseMoneyInput = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const cleaned = trimmed.replace(/[^\d,.-]/g, "");
  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");

  let normalized = cleaned;

  if (hasComma && hasDot) {
    const lastComma = cleaned.lastIndexOf(",");
    const lastDot = cleaned.lastIndexOf(".");

    if (lastComma > lastDot) {
      normalized = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = cleaned.replace(/,/g, "");
    }
  } else if (hasComma) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
};

const formatBrl = (amount: number) => {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(amount);
};

const extractImageFromClipboard = (clipboardData: DataTransfer | null): File | null => {
  if (!clipboardData) {
    return null;
  }

  if (clipboardData.files?.length) {
    const file = Array.from(clipboardData.files).find((candidate) =>
      candidate.type.toLowerCase().startsWith("image/")
    );
    if (file) {
      return file;
    }
  }

  if (!clipboardData.items?.length) {
    return null;
  }

  const imageItem = Array.from(clipboardData.items).find((item) => item.type.toLowerCase().startsWith("image/"));
  return imageItem?.getAsFile() ?? null;
};

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
  const [startImageName, setStartImageName] = useState("");
  const [startAt, setStartAt] = useState(() => toDateTimeLocalValue(new Date()));
  const [startValueBrl, setStartValueBrl] = useState("");
  const [startValueUsd, setStartValueUsd] = useState("");
  const [startConfidence, setStartConfidence] = useState<number | null>(null);
  const [readingStartImage, setReadingStartImage] = useState(false);

  const [endImageUrl, setEndImageUrl] = useState("");
  const [endImageName, setEndImageName] = useState("");
  const [endAt, setEndAt] = useState(() => toDateTimeLocalValue(new Date()));
  const [endValueBrl, setEndValueBrl] = useState("");
  const [endValueUsd, setEndValueUsd] = useState("");
  const [endConfidence, setEndConfidence] = useState<number | null>(null);
  const [readingEndImage, setReadingEndImage] = useState(false);
  const [negativeJustification, setNegativeJustification] = useState("");

  const extractWithOcr = useCallback(async (file: File) => {
    const formData = new FormData();
    formData.append("image", file);
    const response = await api.post<OcrExtractResponse>("/ocr/extract", formData);
    return response.data;
  }, []);

  const resolveBrlValue = useCallback(async (brlInput: string, usdInput: string) => {
    const hasBrl = brlInput.trim().length > 0;
    const hasUsd = usdInput.trim().length > 0;

    if (!hasBrl && !hasUsd) {
      throw new Error("Preencha BRL ou USD.");
    }

    if (hasBrl) {
      return { brlValue: brlInput.trim(), conversionRate: null as number | null };
    }

    const usdValue = parseMoneyInput(usdInput);
    if (usdValue === null) {
      throw new Error("Valor em USD invalido.");
    }

    const fxResponse = await api.get<FxRateResponse>("/fx/usd-brl");
    const rate = Number(fxResponse.data.rate);
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error("Cotacao USD/BRL invalida no momento.");
    }

    return {
      brlValue: formatBrl(usdValue * rate),
      conversionRate: rate
    };
  }, []);

  const applyStartImage = useCallback(
    async (file: File) => {
      setError(null);
      setMessage(null);
      setStartImageName(file.name);
      setStartImageUrl(`upload:${file.name}`);
      setReadingStartImage(true);

      try {
        const ocr = await extractWithOcr(file);
        if (ocr.detectedValue) {
          setStartValueBrl(ocr.detectedValue);
        } else {
          const debugText = (ocr.rawText ?? "").replace(/\s+/g, " ").trim().slice(0, 140);
          setError(
            `OCR nao encontrou valor de faturamento na imagem inicial. Texto lido: ${debugText || "(vazio)"}`
          );
        }
        setStartConfidence(ocr.confidence);
      } catch {
        setError("Nao foi possivel ler a imagem inicial com OCR. Voce ainda pode preencher os campos manualmente.");
      } finally {
        setReadingStartImage(false);
      }
    },
    [extractWithOcr]
  );

  const applyEndImage = useCallback(
    async (file: File) => {
      setError(null);
      setMessage(null);
      setEndImageName(file.name);
      setEndImageUrl(`upload:${file.name}`);
      setReadingEndImage(true);

      try {
        const ocr = await extractWithOcr(file);
        if (ocr.detectedValue) {
          setEndValueBrl(ocr.detectedValue);
        } else {
          const debugText = (ocr.rawText ?? "").replace(/\s+/g, " ").trim().slice(0, 140);
          setError(`OCR nao encontrou valor de faturamento na imagem final. Texto lido: ${debugText || "(vazio)"}`);
        }
        setEndConfidence(ocr.confidence);
      } catch {
        setError("Nao foi possivel ler a imagem final com OCR. Voce ainda pode preencher os campos manualmente.");
      } finally {
        setReadingEndImage(false);
      }
    },
    [extractWithOcr]
  );

  const handlePastedImage = useCallback(
    (file: File) => {
      if (currentShift) {
        void applyEndImage(file);
        return;
      }

      void applyStartImage(file);
    },
    [applyEndImage, applyStartImage, currentShift]
  );

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

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const file = extractImageFromClipboard(event.clipboardData ?? null);

      if (!file) {
        return;
      }

      event.preventDefault();

      handlePastedImage(file);
    };

    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("paste", onPaste);
    };
  }, [handlePastedImage]);

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

    if (!startImageUrl) {
      setError("Envie ou cole a imagem inicial antes de iniciar o turno.");
      setStarting(false);
      return;
    }

    const startedAtIso = parseDateTimeLocalToIso(startAt);
    if (!startedAtIso) {
      setError("Preencha uma data/hora de inicio valida.");
      setStarting(false);
      return;
    }

    try {
      const resolved = await resolveBrlValue(startValueBrl, startValueUsd);
      const response = await api.post("/chatter/shifts/start", {
        modelTagId,
        startedAt: startedAtIso,
        startImageUrl,
        ocrDetectedValue: resolved.brlValue,
        manualConfirmedValue: resolved.brlValue,
        ocrConfidence: startConfidence ?? undefined
      });
      setCurrentShift(response.data.shift);
      await loadData();
      if (resolved.conversionRate) {
        setMessage(
          `Turno iniciado em ${response.data.shift.modelTag.name}. USD convertido para BRL com cotacao ${resolved.conversionRate.toFixed(4)}.`
        );
      } else {
        setMessage(`Turno iniciado em ${response.data.shift.modelTag.name}.`);
      }
    } catch (requestError: any) {
      setError(requestError?.response?.data?.message ?? requestError?.message ?? "Nao foi possivel iniciar o turno.");
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

    if (!endImageUrl) {
      setError("Envie ou cole a imagem final antes de encerrar o turno.");
      setEnding(false);
      return;
    }

    const endedAtIso = parseDateTimeLocalToIso(endAt);
    if (!endedAtIso) {
      setError("Preencha uma data/hora de batida valida.");
      setEnding(false);
      return;
    }

    try {
      const resolved = await resolveBrlValue(endValueBrl, endValueUsd);
      const response = await api.post(`/chatter/shifts/${currentShift.id}/end`, {
        endedAt: endedAtIso,
        endImageUrl,
        ocrDetectedValue: resolved.brlValue,
        manualConfirmedValue: resolved.brlValue,
        ocrConfidence: endConfidence ?? undefined,
        negativeJustification: negativeJustification || undefined
      });

      await loadData();

      if (resolved.conversionRate) {
        setMessage(
          `Turno encerrado. Bruto: ${response.data.grossAmountFormatted} | Comissao: ${response.data.payoutAmountFormatted} | USD convertido com cotacao ${resolved.conversionRate.toFixed(4)}.`
        );
      } else {
        setMessage(
          `Turno encerrado. Bruto: ${response.data.grossAmountFormatted} | Comissao: ${response.data.payoutAmountFormatted}`
        );
      }
      setCurrentShift(null);
      setStartImageName("");
      setStartImageUrl("");
      setStartAt(toDateTimeLocalValue(new Date()));
      setStartValueBrl("");
      setStartValueUsd("");
      setStartConfidence(null);
      setEndImageName("");
      setEndImageUrl("");
      setEndAt(toDateTimeLocalValue(new Date()));
      setEndValueBrl("");
      setEndValueUsd("");
      setEndConfidence(null);
      setNegativeJustification("");
    } catch (requestError: any) {
      setError(requestError?.response?.data?.message ?? requestError?.message ?? "Nao foi possivel encerrar o turno.");
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
            Inicio do ponto
            <input
              type="datetime-local"
              value={startAt}
              onChange={(e) => setStartAt(e.target.value)}
              required
            />
          </label>

          <label>
            Imagem inicial (arquivo ou Ctrl+V)
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  void applyStartImage(file);
                }
              }}
            />
            {startImageName ? <small className="muted">Arquivo selecionado: {startImageName}</small> : null}
            {readingStartImage ? <small className="muted">Lendo imagem com OCR...</small> : null}
          </label>

          <div
            className="paste-target"
            tabIndex={0}
            onPaste={(event) => {
              const file = extractImageFromClipboard(event.clipboardData);
              if (!file) {
                return;
              }
              event.preventDefault();
              handlePastedImage(file);
            }}
          >
            Clique aqui e pressione Ctrl+V para colar a imagem inicial.
          </div>

          <label>
            Valor BRL (opcional)
            <input
              value={startValueBrl}
              onChange={(e) => setStartValueBrl(e.target.value)}
              placeholder="R$ 1.234,56"
            />
          </label>

          <label>
            Valor USD (opcional)
            <input
              value={startValueUsd}
              onChange={(e) => setStartValueUsd(e.target.value)}
              placeholder="ex: 250.00"
            />
            <small className="muted">Preencha BRL ou USD. Se preencher USD, o sistema converte para BRL com a cotacao atual.</small>
            {startConfidence !== null ? (
              <small className="muted">Confianca OCR detectada: {startConfidence.toFixed(2)}</small>
            ) : null}
          </label>

          <button className="primary-button" type="submit" disabled={starting}>
            {starting ? "Iniciando..." : "Iniciar periodo"}
          </button>
        </form>
      ) : (
        <form className="card form-grid" onSubmit={endShift}>
          <h2>Encerrar turno</h2>

          <label>
            Batida do ponto
            <input
              type="datetime-local"
              value={endAt}
              onChange={(e) => setEndAt(e.target.value)}
              required
            />
          </label>

          <label>
            Imagem final (arquivo ou Ctrl+V)
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  void applyEndImage(file);
                }
              }}
            />
            {endImageName ? <small className="muted">Arquivo selecionado: {endImageName}</small> : null}
            {readingEndImage ? <small className="muted">Lendo imagem com OCR...</small> : null}
          </label>

          <div
            className="paste-target"
            tabIndex={0}
            onPaste={(event) => {
              const file = extractImageFromClipboard(event.clipboardData);
              if (!file) {
                return;
              }
              event.preventDefault();
              handlePastedImage(file);
            }}
          >
            Clique aqui e pressione Ctrl+V para colar a imagem final.
          </div>

          <label>
            Valor BRL (opcional)
            <input
              value={endValueBrl}
              onChange={(e) => setEndValueBrl(e.target.value)}
              placeholder="R$ 1.450,00"
            />
          </label>

          <label>
            Valor USD (opcional)
            <input
              value={endValueUsd}
              onChange={(e) => setEndValueUsd(e.target.value)}
              placeholder="ex: 300.00"
            />
            <small className="muted">Preencha BRL ou USD. Se preencher USD, o sistema converte para BRL com a cotacao atual.</small>
            {endConfidence !== null ? (
              <small className="muted">Confianca OCR detectada: {endConfidence.toFixed(2)}</small>
            ) : null}
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

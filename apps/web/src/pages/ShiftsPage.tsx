import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import { ImageDropzone } from "../components/ImageDropzone";
import { MoneyField } from "../components/MoneyField";
import { formatBrl, parseMoneyInput } from "../lib/money";
import type { MoneyCurrency } from "../lib/money";
import type { OcrExtractResponse, FxRateResponse } from "../types/api";
import { useToast } from "../components/Toast";
import { getApiErrorMessage } from "../lib/apiError";
import { ModalDialog } from "../components/ModalDialog";

type Shift = {
  id: string;
  modelTagId: string;
  startedAt: string;
  startValueCents: number;
  startOriginalCurrency?: string | null;
  startOriginalAmountCents?: number | null;
  startFxRate?: string | number | null;
  modelTag: { id: string; name: string };
};

type Room = { id: string; name: string };

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

const centsToMoneyInput = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

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

export const ShiftsPage = () => {
  const { user } = useAuth();
  const toast = useToast();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [currentShift, setCurrentShift] = useState<Shift | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);
  const [loading, setLoading] = useState(true);

  const [modelTagId, setModelTagId] = useState("");
  const [startEvidenceId, setStartEvidenceId] = useState("");
  const [startImageName, setStartImageName] = useState("");
  const [startAt, setStartAt] = useState(() => toDateTimeLocalValue(new Date()));
  const [startValue, setStartValue] = useState("");
  const [startCurrency, setStartCurrency] = useState<MoneyCurrency>("BRL");
  const [startConfidence, setStartConfidence] = useState<number | null>(null);
  const [readingStartImage, setReadingStartImage] = useState(false);

  const [endEvidenceId, setEndEvidenceId] = useState("");
  const [endImageName, setEndImageName] = useState("");
  const [endAt, setEndAt] = useState(() => toDateTimeLocalValue(new Date()));
  const [endValue, setEndValue] = useState("");
  const [endCurrency, setEndCurrency] = useState<MoneyCurrency>("BRL");
  const [endConfidence, setEndConfidence] = useState<number | null>(null);
  const [readingEndImage, setReadingEndImage] = useState(false);
  const [negativeJustification, setNegativeJustification] = useState("");
  const [fxRate, setFxRate] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const extractWithOcr = useCallback(async (file: File) => {
    const formData = new FormData();
    formData.append("image", file);
    const response = await api.post<OcrExtractResponse>("/ocr/extract", formData);
    return response.data;
  }, []);

  const resolveBrlValue = useCallback(async (value: string, currency: MoneyCurrency) => {
    if (!value.trim()) {
      throw new Error("Preencha o valor de faturamento.");
    }

    if (currency === "BRL") {
      const original = parseMoneyInput(value);
      return {
        brlValue: value.trim(),
        conversionRate: null as number | null,
        moneyMetadata: {
          currency: "BRL" as const,
          originalAmountCents: Math.round((original ?? 0) * 100)
        }
      };
    }

    const usdValue = parseMoneyInput(value);
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
      conversionRate: rate,
      moneyMetadata: {
        currency: "USD" as const,
        originalAmountCents: Math.round(usdValue * 100),
        fxRate: rate,
        fxProvider: fxResponse.data.provider ?? "AwesomeAPI",
        fxQuotedAt: fxResponse.data.quotedAt ?? new Date().toISOString()
      }
    };
  }, []);

  const applyStartImage = useCallback(
    async (file: File) => {
      setError(null);
      setStartImageName(file.name);
      setStartEvidenceId("");
      setReadingStartImage(true);

      try {
        const ocr = await extractWithOcr(file);
        setStartEvidenceId(ocr.evidence.id);
        if (ocr.detectedValue) {
          setStartValue(ocr.detectedValue);
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
      setEndImageName(file.name);
      setEndEvidenceId("");
      setReadingEndImage(true);

      try {
        const ocr = await extractWithOcr(file);
        setEndEvidenceId(ocr.evidence.id);
        if (ocr.detectedValue) {
          setEndValue(ocr.detectedValue);
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
    try {
      const [roomsResponse, shiftResponse] = await Promise.all([
        api.get("/chat/rooms"),
        api.get("/chatter/shifts/current")
      ]);

      const openShift = shiftResponse.data.shift as Shift | null;
      setRooms(roomsResponse.data.rooms);
      setCurrentShift(openShift);

      if (openShift) {
        const originalCurrency: MoneyCurrency = openShift.startOriginalCurrency === "USD" ? "USD" : "BRL";
        const originalCents = originalCurrency === "USD"
          ? openShift.startOriginalAmountCents ?? openShift.startValueCents
          : openShift.startValueCents;
        setStartAt(toDateTimeLocalValue(new Date(openShift.startedAt)));
        setStartCurrency(originalCurrency);
        setStartValue(centsToMoneyInput(originalCents));
        const persistedRate = Number(openShift.startFxRate);
        if (originalCurrency === "USD" && Number.isFinite(persistedRate) && persistedRate > 0) {
          setFxRate(persistedRate);
        }
      }

      if (!modelTagId && roomsResponse.data.rooms.length) {
        setModelTagId(roomsResponse.data.rooms[0].id);
      }
    } finally {
      setLoading(false);
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

  useEffect(() => {
    if (startCurrency !== "USD" && endCurrency !== "USD") {
      return;
    }

    let cancelled = false;
    api
      .get<FxRateResponse>("/fx/usd-brl")
      .then((response) => {
        const rate = Number(response.data.rate);
        if (!cancelled && Number.isFinite(rate) && rate > 0) {
          setFxRate(rate);
        }
      })
      .catch(() => {
        // cotacao indisponivel: MPH do turno fica oculto enquanto houver valor em USD
      });

return () => {
      cancelled = true;
    };
  }, [startCurrency, endCurrency]);

  const currentTurnMph = useMemo(() => {
    if (!currentShift) {
      return null;
    }

    const startNum = parseMoneyInput(startValue);
    const endNum = parseMoneyInput(endValue);
    if (startNum === null || endNum === null) {
      return null;
    }

    const startMs = new Date(startAt).getTime();
    const endMs = new Date(endAt).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      return null;
    }

    const startBrl = startCurrency === "USD" ? (fxRate !== null ? startNum * fxRate : null) : startNum;
    const endBrl = endCurrency === "USD" ? (fxRate !== null ? endNum * fxRate : null) : endNum;
    if (startBrl === null || endBrl === null) {
      return null;
    }

    const gross = endBrl - startBrl;
    const hours = (endMs - startMs) / 3600000;
    if (hours <= 0) {
      return null;
    }

    return { gross, hours, mph: gross / hours };
  }, [currentShift, startValue, endValue, startCurrency, endCurrency, startAt, endAt, fxRate]);

  if (user?.role === "MANAGER") {
    return (
      <section className="stack-gap">
        <div className="page-header">
          <div>
            <h1>Horários</h1>
            <p>Gerencie seus turnos</p>
          </div>
        </div>
        <div className="card">
          <h2>Visao do gerente</h2>
          <p>Use Chatters, Tags e Pagamento para administrar a operacao.</p>
        </div>
      </section>
    );
  }

  if (loading) {
    return <section className="stack-gap"><div className="card skeleton-list" aria-label="Carregando turnos"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div></section>;
  }

  if (!currentShift && rooms.length === 0) {
    return <section className="stack-gap"><div className="page-header"><div><h1>Horários</h1><p>Bata seu ponto de entrada e saída</p></div></div><div className="card"><p className="empty-hint">Você ainda não possui uma tag de modelo vinculada. Peça a um gerente para liberar um modelo antes de iniciar o turno.</p></div></section>;
  }

  const startShift = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setStarting(true);

    if (!startEvidenceId) {
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
      const resolved = await resolveBrlValue(startValue, startCurrency);
      const response = await api.post("/chatter/shifts/start", {
        modelTagId,
        startedAt: startedAtIso,
        startEvidenceId,
        ocrDetectedValue: resolved.brlValue,
        manualConfirmedValue: resolved.brlValue,
        ocrConfidence: startConfidence ?? undefined,
        moneyMetadata: resolved.moneyMetadata
      });
      setCurrentShift(response.data.shift);
      await loadData();
      toast.success("Turno iniciado com sucesso.");
    } catch (requestError: unknown) {
      const feedback = getApiErrorMessage(requestError, "Nao foi possivel iniciar o turno.");
      toast.error(feedback);
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
    setEnding(true);

    if (!endEvidenceId) {
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
      const resolved = await resolveBrlValue(endValue, endCurrency);
      await api.post(`/chatter/shifts/${currentShift.id}/end`, {
        endedAt: endedAtIso,
        endEvidenceId,
        ocrDetectedValue: resolved.brlValue,
        manualConfirmedValue: resolved.brlValue,
        ocrConfidence: endConfidence ?? undefined,
        negativeJustification: negativeJustification || undefined,
        moneyMetadata: resolved.moneyMetadata
      });

      await loadData();
      toast.success("Turno encerrado com sucesso.");
      setCurrentShift(null);
      setStartImageName("");
      setStartEvidenceId("");
      setStartAt(toDateTimeLocalValue(new Date()));
      setStartValue("");
      setStartCurrency("BRL");
      setStartConfidence(null);
      setEndImageName("");
      setEndEvidenceId("");
      setEndAt(toDateTimeLocalValue(new Date()));
      setEndValue("");
      setEndCurrency("BRL");
      setEndConfidence(null);
      setNegativeJustification("");
    } catch (requestError: unknown) {
      const feedback = getApiErrorMessage(requestError, "Nao foi possivel encerrar o turno.");
      toast.error(feedback);
    } finally {
      setEnding(false);
    }
  };

  const deleteShift = async () => {
    if (!currentShift) {
      return;
    }

    setError(null);
    setDeleting(true);

    try {
      await api.delete(`/chatter/shifts/${currentShift.id}`);
      setConfirmDelete(false);
      setCurrentShift(null);
      setStartImageName("");
      setStartEvidenceId("");
      setStartAt(toDateTimeLocalValue(new Date()));
      setStartValue("");
      setStartCurrency("BRL");
      setStartConfidence(null);
      setEndImageName("");
      setEndEvidenceId("");
      setEndAt(toDateTimeLocalValue(new Date()));
      setEndValue("");
      setEndCurrency("BRL");
      setEndConfidence(null);
      setNegativeJustification("");
      toast.success("Turno cancelado com sucesso.");
    } catch (requestError: unknown) {
      const feedback = getApiErrorMessage(requestError, "Nao foi possivel cancelar o turno.");
      toast.error(feedback);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section className="stack-gap">
      <div className="page-header">
        <div>
          <h1>Horários</h1>
          <p>Bata seu ponto de entrada e saída</p>
        </div>
      </div>

      {!currentShift ? (
        <form className="card form-grid" onSubmit={startShift}>
          <h2>Iniciar turno</h2>

          <div className="form-grid-2">
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
              Início do ponto
              <input
                type="datetime-local"
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
                required
              />
            </label>
          </div>

          <ImageDropzone
            title="Print do faturamento (início)"
            fileName={startImageName}
            reading={readingStartImage}
            onFile={(file) => void applyStartImage(file)}
          />

          <MoneyField
            value={startValue}
            onValueChange={setStartValue}
            currency={startCurrency}
            onCurrencyChange={setStartCurrency}
            confidence={startConfidence}
            reading={readingStartImage}
          />

          <button className="primary-button" type="submit" disabled={starting}>
            {starting ? "Iniciando..." : "Iniciar período"}
          </button>
        </form>
      ) : (
        <form className="card form-grid" onSubmit={endShift}>
          <h2>
            Encerrar turno
            <span className="status-badge open">Aberto em {currentShift.modelTag.name}</span>
          </h2>

          <label>
            Batida do ponto
            <input
              type="datetime-local"
              value={endAt}
              onChange={(e) => setEndAt(e.target.value)}
              required
            />
          </label>

          <ImageDropzone
            title="Print do faturamento (fim)"
            fileName={endImageName}
            reading={readingEndImage}
            onFile={(file) => void applyEndImage(file)}
          />

          <MoneyField
            value={endValue}
            onValueChange={setEndValue}
            currency={endCurrency}
            onCurrencyChange={setEndCurrency}
            confidence={endConfidence}
            reading={readingEndImage}
          />

          {currentTurnMph ? (
            <div className={`mph-chip ${currentTurnMph.gross < 0 ? "mph-negative" : ""}`}>
              <span>MPH do turno</span>
              <strong>{formatBrl(currentTurnMph.mph)}/h</strong>
              <small>
                {formatBrl(currentTurnMph.gross)} bruto · {currentTurnMph.hours.toFixed(1)}h
              </small>
            </div>
          ) : null}

          {currentTurnMph && currentTurnMph.gross < 0 ? (
            <div className="negative-warning">
              Saldo negativo detectado — a justificativa abaixo é obrigatória para encerrar o turno.
            </div>
          ) : null}

          {currentTurnMph && currentTurnMph.gross < 0 ? (
            <label>
              Justificativa para saldo negativo
              <textarea
                value={negativeJustification}
                onChange={(e) => setNegativeJustification(e.target.value)}
                placeholder="Explique por que o valor final ficou menor que o inicial."
                required
              />
            </label>
          ) : null}

          <button className="primary-button" type="submit" disabled={ending}>
            {ending ? "Encerrando..." : "Encerrar período"}
          </button>

          <button
            type="button"
            className="danger-button"
            onClick={() => setConfirmDelete(true)}
            disabled={ending || deleting}
          >
            Cancelar turno
          </button>
        </form>
      )}

      <ModalDialog
        open={confirmDelete && Boolean(currentShift)}
        onClose={() => setConfirmDelete(false)}
        ariaLabel="Cancelar turno"
      >
        {currentShift ? (
          <>
            <h2>Cancelar turno</h2>
            <p>
              Tem certeza que deseja excluir o turno aberto em <strong>{currentShift.modelTag.name}</strong>?
              Essa ação não pode ser desfeita.
            </p>
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => setConfirmDelete(false)} disabled={deleting}>
                Voltar
              </button>
              <button className="danger-button" onClick={() => void deleteShift()} disabled={deleting}>
                {deleting ? "Excluindo..." : "Sim, excluir turno"}
              </button>
            </div>
          </>
        ) : null}
      </ModalDialog>

      {error ? <div className="error-box">{error}</div> : null}
    </section>
  );
};

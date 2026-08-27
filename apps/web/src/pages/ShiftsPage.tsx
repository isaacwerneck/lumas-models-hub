import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ImageDropzone } from "../components/ImageDropzone";
import { ModalDialog } from "../components/ModalDialog";
import { MoneyField } from "../components/MoneyField";
import { useToast } from "../components/Toast";
import { useAuth } from "../auth/AuthContext";
import { api } from "../lib/api";
import { getApiErrorMessage } from "../lib/apiError";
import { formatBrl, parseMoneyInput } from "../lib/money";
import type { MoneyCurrency } from "../lib/money";
import type { FxRateResponse, OcrExtractResponse } from "../types/api";

type Shift = { id: string; batchId?: string | null; modelTagId: string; startedAt: string; startValueCents: number; startOriginalCurrency?: string | null; startOriginalAmountCents?: number | null; modelTag: { id: string; name: string } };
type Room = { id: string; name: string };
type ShiftMode = "live" | "retroactive";
type EvidenceSide = "start" | "end";
type DraftScope = "live" | "retroactive" | "closing";
type EvidenceDraft = { evidenceId: string; imageName: string; value: string; currency: MoneyCurrency; confidence: number | null; reading: boolean };
type ModelDraft = { key: string; modelTagId: string; start: EvidenceDraft; end: EvidenceDraft; negativeJustification: string };
type ClosingDraft = ModelDraft & { shift: Shift };

const emptyEvidence = (): EvidenceDraft => ({ evidenceId: "", imageName: "", value: "", currency: "BRL", confidence: null, reading: false });
const emptyModelDraft = (modelTagId = ""): ModelDraft => ({ key: crypto.randomUUID(), modelTagId, start: emptyEvidence(), end: emptyEvidence(), negativeJustification: "" });
const toDateTimeLocalValue = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const parseDateTimeLocalToIso = (value: string) => {
  const parsed = new Date(value);
  return value.trim() && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null;
};
const centsToMoneyInput = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
const extractImageFromClipboard = (clipboardData: DataTransfer | null): File | null => {
  if (!clipboardData) return null;
  const file = Array.from(clipboardData.files ?? []).find((candidate) => candidate.type.toLowerCase().startsWith("image/"));
  if (file) return file;
  return Array.from(clipboardData.items ?? []).find((item) => item.type.toLowerCase().startsWith("image/"))?.getAsFile() ?? null;
};
const isTextEditingTarget = (target: EventTarget | null) => target instanceof HTMLElement
  && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
const hasNegativeBalance = (draft: ModelDraft) => {
  if (draft.start.currency !== draft.end.currency) return false;
  const start = parseMoneyInput(draft.start.value);
  const end = parseMoneyInput(draft.end.value);
  return start !== null && end !== null && end < start;
};

type ValueFieldsProps = { draftKey: string; side: EvidenceSide; label: string; value: EvidenceDraft; pasteTarget: string | null; onActivate: () => void; onFile: (file: File) => void; onChange: (patch: Partial<EvidenceDraft>) => void };
const ValueFields = ({ draftKey, side, label, value, pasteTarget, onActivate, onFile, onChange }: ValueFieldsProps) => (
  <div className="shift-value-fields">
    <ImageDropzone title={`Print do faturamento (${label})`} fileName={value.imageName} reading={value.reading}
      active={pasteTarget?.endsWith(`${draftKey}:${side}`)} onActivate={onActivate} onFile={onFile} />
    <MoneyField value={value.value} onValueChange={(next) => onChange({ value: next })} currency={value.currency}
      onCurrencyChange={(currency) => onChange({ currency })} confidence={value.confidence} reading={value.reading} />
  </div>
);

export const ShiftsPage = () => {
  const { user } = useAuth();
  const toast = useToast();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [currentShifts, setCurrentShifts] = useState<Shift[]>([]);
  const [mode, setMode] = useState<ShiftMode>("live");
  const [liveDrafts, setLiveDrafts] = useState<ModelDraft[]>([emptyModelDraft()]);
  const [retroDrafts, setRetroDrafts] = useState<ModelDraft[]>([emptyModelDraft()]);
  const [closingDrafts, setClosingDrafts] = useState<ClosingDraft[]>([]);
  const [liveStartAt, setLiveStartAt] = useState(() => toDateTimeLocalValue(new Date()));
  const [retroStartAt, setRetroStartAt] = useState(() => toDateTimeLocalValue(new Date(Date.now() - 2 * 60 * 60_000)));
  const [retroEndAt, setRetroEndAt] = useState(() => toDateTimeLocalValue(new Date(Date.now() - 60 * 60_000)));
  const [closeAt, setCloseAt] = useState(() => toDateTimeLocalValue(new Date()));
  const [pasteTarget, setPasteTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const notificationsEnabled = typeof Notification !== "undefined" && Notification.permission === "granted";

  const extractWithOcr = useCallback(async (file: File) => {
    const formData = new FormData();
    formData.append("image", file);
    return (await api.post<OcrExtractResponse>("/ocr/extract", formData)).data;
  }, []);

  const loadData = useCallback(async () => {
    try {
      const [roomResponse, shiftResponse] = await Promise.all([
        api.get<{ rooms: Room[] }>("/chat/rooms"),
        api.get<{ shifts?: Shift[]; shift?: Shift | null }>("/chatter/shifts/current")
      ]);
      const nextRooms = roomResponse.data.rooms;
      const nextShifts = shiftResponse.data.shifts ?? (shiftResponse.data.shift ? [shiftResponse.data.shift] : []);
      setRooms(nextRooms);
      setCurrentShifts(nextShifts);
      const fillModels = (drafts: ModelDraft[]) => drafts.map((draft, index) => ({ ...draft, modelTagId: draft.modelTagId || nextRooms[index]?.id || nextRooms[0]?.id || "" }));
      setLiveDrafts(fillModels);
      setRetroDrafts(fillModels);
      setClosingDrafts(nextShifts.map((shift) => {
        const currency: MoneyCurrency = shift.startOriginalCurrency === "USD" ? "USD" : "BRL";
        const cents = currency === "USD" ? shift.startOriginalAmountCents ?? shift.startValueCents : shift.startValueCents;
        return { ...emptyModelDraft(shift.modelTagId), key: shift.id, shift, start: { ...emptyEvidence(), value: centsToMoneyInput(cents), currency } };
      }));
    } catch (requestError: unknown) {
      setError(getApiErrorMessage(requestError, "Não foi possível carregar seus turnos."));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  useEffect(() => {
    if (!error) return;
    const frame = window.requestAnimationFrame(() => errorRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [error]);

  const setDraftEvidence = useCallback((scope: DraftScope, key: string, side: EvidenceSide, patch: Partial<EvidenceDraft>) => {
    const update = <T extends ModelDraft>(items: T[]) => items.map((item) => item.key === key ? { ...item, [side]: { ...item[side], ...patch } } : item);
    if (scope === "live") setLiveDrafts(update);
    if (scope === "retroactive") setRetroDrafts(update);
    if (scope === "closing") setClosingDrafts(update);
  }, []);

  const applyImage = useCallback(async (scope: DraftScope, key: string, side: EvidenceSide, file: File) => {
    setError(null);
    setDraftEvidence(scope, key, side, { imageName: file.name, evidenceId: "", reading: true });
    try {
      const ocr = await extractWithOcr(file);
      setDraftEvidence(scope, key, side, { evidenceId: ocr.evidence.id, value: ocr.detectedValue ?? "", confidence: ocr.confidence, reading: false });
      if (!ocr.detectedValue) {
        const text = (ocr.rawText ?? "").replace(/\s+/g, " ").trim().slice(0, 140);
        setError(`OCR não encontrou o valor. Preencha manualmente. Texto lido: ${text || "(vazio)"}`);
      }
    } catch {
      setDraftEvidence(scope, key, side, { reading: false });
      setError("Não foi possível ler a imagem com OCR. Você ainda pode preencher o valor manualmente.");
    }
  }, [extractWithOcr, setDraftEvidence]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (isTextEditingTarget(event.target) || !pasteTarget) return;
      const file = extractImageFromClipboard(event.clipboardData ?? null);
      if (!file) return;
      const [scope, key, side] = pasteTarget.split(":") as [DraftScope, string, EvidenceSide];
      event.preventDefault();
      void applyImage(scope, key, side, file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [applyImage, pasteTarget]);

  const resolveBrlValue = useCallback(async (draft: EvidenceDraft) => {
    const amount = parseMoneyInput(draft.value);
    if (amount === null) throw new Error("Preencha um valor válido para todas as modelos.");
    if (draft.currency === "BRL") return { value: draft.value.trim(), moneyMetadata: { currency: "BRL" as const, originalAmountCents: Math.round(amount * 100) } };
    const response = await api.get<FxRateResponse>("/fx/usd-brl");
    const rate = Number(response.data.rate);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error("Cotação USD/BRL indisponível.");
    return { value: formatBrl(amount * rate), moneyMetadata: { currency: "USD" as const, originalAmountCents: Math.round(amount * 100), fxRate: rate, fxProvider: response.data.provider ?? "AwesomeAPI", fxQuotedAt: response.data.quotedAt ?? new Date().toISOString() } };
  }, []);
  const valuePayload = useCallback(async (draft: EvidenceDraft) => {
    if (!draft.evidenceId) throw new Error("Envie uma imagem para cada campo solicitado.");
    const resolved = await resolveBrlValue(draft);
    return { evidenceId: draft.evidenceId, ocrConfidence: draft.confidence ?? undefined, ocrDetectedValue: resolved.value, manualConfirmedValue: resolved.value, moneyMetadata: resolved.moneyMetadata };
  }, [resolveBrlValue]);

  const addModel = (scope: "live" | "retroactive") => {
    const drafts = scope === "live" ? liveDrafts : retroDrafts;
    const nextRoom = rooms.find((room) => !drafts.some((draft) => draft.modelTagId === room.id));
    if (!nextRoom || drafts.length >= 2) return;
    (scope === "live" ? setLiveDrafts : setRetroDrafts)((current) => [...current, emptyModelDraft(nextRoom.id)]);
  };
  const removeModel = (scope: "live" | "retroactive", key: string) => {
    (scope === "live" ? setLiveDrafts : setRetroDrafts)((current) => current.length > 1 ? current.filter((item) => item.key !== key) : current);
  };
  const updateModel = (scope: "live" | "retroactive", key: string, modelTagId: string) => {
    (scope === "live" ? setLiveDrafts : setRetroDrafts)((current) => current.map((item) => item.key === key ? { ...item, modelTagId } : item));
  };
  const feedbackFor = (requestError: unknown, fallback: string) => requestError instanceof Error && !("response" in requestError)
    ? requestError.message : getApiErrorMessage(requestError, fallback);

  const submitLiveStart = async (event: FormEvent) => {
    event.preventDefault(); setError(null); setSubmitting(true);
    try {
      if (!notificationsEnabled) throw new Error("Ative as notificações nas Preferências antes de abrir o ponto.");
      const startedAt = parseDateTimeLocalToIso(liveStartAt);
      if (!startedAt) throw new Error("Preencha uma data/hora inicial válida.");
      const shifts = await Promise.all(liveDrafts.map(async (draft) => ({ modelTagId: draft.modelTagId, ...(await valuePayload(draft.start)) })));
      await api.post("/chatter/shifts/start-batch", { startedAt, notificationsEnabled: true, shifts });
      toast.success(shifts.length === 2 ? "Pontos iniciados nas duas modelos." : "Ponto iniciado com sucesso.");
      setLiveDrafts([emptyModelDraft(rooms[0]?.id ?? "")]); await loadData();
    } catch (requestError: unknown) { const message = feedbackFor(requestError, "Não foi possível iniciar o ponto."); setError(message); toast.error(message); }
    finally { setSubmitting(false); }
  };

  const submitClose = async (event: FormEvent) => {
    event.preventDefault(); setError(null); setSubmitting(true);
    try {
      const endedAt = parseDateTimeLocalToIso(closeAt);
      if (!endedAt) throw new Error("Preencha uma data/hora final válida.");
      const shifts = await Promise.all(closingDrafts.map(async (draft) => ({ shiftId: draft.shift.id, ...(await valuePayload(draft.end)), negativeJustification: draft.negativeJustification || undefined })));
      await api.post("/chatter/shifts/end-batch", { endedAt, shifts });
      toast.success(shifts.length === 2 ? "Pontos encerrados nas duas modelos." : "Ponto encerrado com sucesso.");
      setCloseAt(toDateTimeLocalValue(new Date())); await loadData();
    } catch (requestError: unknown) { const message = feedbackFor(requestError, "Não foi possível encerrar o ponto."); setError(message); toast.error(message); }
    finally { setSubmitting(false); }
  };

  const submitRetroactive = async (event: FormEvent) => {
    event.preventDefault(); setError(null); setSubmitting(true);
    try {
      const startedAt = parseDateTimeLocalToIso(retroStartAt); const endedAt = parseDateTimeLocalToIso(retroEndAt);
      if (!startedAt || !endedAt) throw new Error("Preencha os horários de entrada e saída.");
      const shifts = await Promise.all(retroDrafts.map(async (draft) => ({ modelTagId: draft.modelTagId, start: await valuePayload(draft.start), end: await valuePayload(draft.end), negativeJustification: draft.negativeJustification || undefined })));
      await api.post("/chatter/shifts/retroactive-batch", { startedAt, endedAt, shifts });
      toast.success(shifts.length === 2 ? "Turnos anteriores lançados nas duas modelos." : "Turno anterior lançado com sucesso.");
      setRetroDrafts([emptyModelDraft(rooms[0]?.id ?? "")]);
    } catch (requestError: unknown) { const message = feedbackFor(requestError, "Não foi possível lançar o turno anterior."); setError(message); toast.error(message); }
    finally { setSubmitting(false); }
  };

  const cancelCurrentBatch = async () => {
    setSubmitting(true);
    try {
      const batchId = currentShifts[0]?.batchId;
      if (batchId && currentShifts.every((shift) => shift.batchId === batchId)) await api.delete(`/chatter/shifts/batches/${batchId}`);
      else await Promise.all(currentShifts.map((shift) => api.delete(`/chatter/shifts/${shift.id}`)));
      setConfirmCancel(false); toast.success("Ponto aberto cancelado."); await loadData();
    } catch (requestError: unknown) { toast.error(getApiErrorMessage(requestError, "Não foi possível cancelar o ponto.")); }
    finally { setSubmitting(false); }
  };

  const closeMph = useMemo(() => closingDrafts.map((draft) => {
    if (draft.start.currency !== "BRL" || draft.end.currency !== "BRL") return null;
    const start = parseMoneyInput(draft.start.value); const end = parseMoneyInput(draft.end.value);
    const hours = (new Date(closeAt).getTime() - new Date(draft.shift.startedAt).getTime()) / 3_600_000;
    return start !== null && end !== null && hours > 0 ? (end - start) / hours : null;
  }), [closeAt, closingDrafts]);

  if (user?.role === "MANAGER") return <section className="stack-gap"><div className="page-header"><div><h1>Horários</h1><p>Gerencie seus turnos</p></div></div><div className="card"><h2>Visão do gerente</h2><p>Use Equipe e Pagamentos para administrar a operação.</p></div></section>;
  if (loading) return <section className="stack-gap"><div className="page-header"><div><h1>Horários</h1></div></div><div className="card skeleton-list"><div className="skeleton" /><div className="skeleton" /></div></section>;
  if (!rooms.length && !currentShifts.length) return <section className="stack-gap"><div className="page-header"><div><h1>Horários</h1></div></div><div className="card"><p className="empty-hint">Você ainda não possui uma modelo vinculada. Peça a um gerente para liberar uma.</p></div></section>;

  const modelSelector = (scope: "live" | "retroactive", draft: ModelDraft, drafts: ModelDraft[]) => (
    <div className="shift-model-heading"><label>Modelo<select value={draft.modelTagId} onChange={(event) => updateModel(scope, draft.key, event.target.value)} required>
      {rooms.map((room) => <option key={room.id} value={room.id} disabled={drafts.some((item) => item.key !== draft.key && item.modelTagId === room.id)}>{room.name}</option>)}
    </select></label>{drafts.length > 1 ? <button type="button" className="secondary-button compact-button" onClick={() => removeModel(scope, draft.key)}>Remover</button> : null}</div>
  );
  const fields = (scope: DraftScope, draft: ModelDraft, side: EvidenceSide, label: string) => <ValueFields draftKey={draft.key} side={side} label={label} value={draft[side]} pasteTarget={pasteTarget}
    onActivate={() => setPasteTarget(`${scope}:${draft.key}:${side}`)} onFile={(file) => void applyImage(scope, draft.key, side, file)} onChange={(patch) => setDraftEvidence(scope, draft.key, side, patch)} />;
  const workflowError = error ? <div ref={errorRef} className="error-box shift-workflow-error" role="alert" tabIndex={-1}>{error}</div> : null;

  return <section className="stack-gap shifts-page">
    <div className="page-header"><div><h1>Horários</h1><p>Registre pontos atuais ou lance um período anterior</p></div></div>
    <div className="shift-mode-switch segmented" role="group" aria-label="Tipo de lançamento">
      <button type="button" className={mode === "live" ? "active" : ""} aria-pressed={mode === "live"} onClick={() => { setMode("live"); setError(null); }}>Abrir ponto</button>
      <button type="button" className={mode === "retroactive" ? "active" : ""} aria-pressed={mode === "retroactive"} onClick={() => { setMode("retroactive"); setError(null); }}>Lançar turno anterior</button>
    </div>

    {mode === "live" && !currentShifts.length ? <form className="card form-grid shift-workflow-card" onSubmit={submitLiveStart}>
      <div className="section-header"><div><h2>Abrir ponto</h2><p>Uma ou duas modelos com o mesmo horário de entrada.</p></div></div>
      {!notificationsEnabled ? <div className="warning-box" role="alert">Ative as notificações em <Link to="/config">Preferências</Link> antes de abrir o ponto.</div> : null}
      <label className="shared-time-field">Início do ponto<input type="datetime-local" value={liveStartAt} onChange={(event) => setLiveStartAt(event.target.value)} required /></label>
      <div className="shift-model-grid">{liveDrafts.map((draft) => <section className="shift-model-panel" key={draft.key}>{modelSelector("live", draft, liveDrafts)}{fields("live", draft, "start", "início")}</section>)}</div>
      {liveDrafts.length < 2 && rooms.length > liveDrafts.length ? <button type="button" className="secondary-button add-model-button" onClick={() => addModel("live")}>+ Adicionar segunda modelo</button> : null}
      {workflowError}
      <button className="primary-button" type="submit" disabled={submitting || !notificationsEnabled}>{submitting ? "Abrindo…" : liveDrafts.length === 2 ? "Abrir os dois pontos" : "Abrir ponto"}</button>
    </form> : null}

    {mode === "live" && currentShifts.length ? <form className="card form-grid shift-workflow-card" onSubmit={submitClose}>
      <div className="section-header"><div><h2>Encerrar turno</h2><p>{currentShifts.length === 2 ? "As duas modelos serão encerradas juntas." : `Ponto aberto em ${currentShifts[0].modelTag.name}.`}</p></div></div>
      <label className="shared-time-field">Saída do ponto<input type="datetime-local" value={closeAt} onChange={(event) => setCloseAt(event.target.value)} required /></label>
      <div className="shift-model-grid">{closingDrafts.map((draft, index) => <section className="shift-model-panel" key={draft.key}>
        <div className="shift-model-heading"><div><span className="field-hint">Modelo</span><h3>{draft.shift.modelTag.name}</h3></div><span className="status-badge open">Em aberto</span></div>
        {fields("closing", draft, "end", "fim")}
        {closeMph[index] !== null ? <div className={`mph-chip ${closeMph[index]! < 0 ? "mph-negative" : ""}`}><span>MPH estimado</span><strong>{formatBrl(closeMph[index]!)}/h</strong></div> : null}
        {hasNegativeBalance(draft) ? <label>Justificativa para saldo negativo<textarea value={draft.negativeJustification} maxLength={500} required onChange={(event) => setClosingDrafts((current) => current.map((item) => item.key === draft.key ? { ...item, negativeJustification: event.target.value } : item))} /></label> : null}
      </section>)}</div>
      {workflowError}
      <div className="shift-close-actions" role="group" aria-label="Ações do ponto aberto"><button type="button" className="danger-button" onClick={() => setConfirmCancel(true)} disabled={submitting}>{currentShifts.length === 2 ? "Cancelar os dois pontos" : "Cancelar ponto"}</button><button className="primary-button" type="submit" disabled={submitting}>{submitting ? "Encerrando…" : currentShifts.length === 2 ? "Encerrar os dois pontos" : "Encerrar ponto"}</button></div>
    </form> : null}

    {mode === "retroactive" ? <form className="card form-grid shift-workflow-card" onSubmit={submitRetroactive}>
      <div className="section-header"><div><h2>Lançar turno anterior</h2><p>Entrada e saída são conferidas juntas para não cruzar outro turno.</p></div></div>
      <div className="form-grid-2"><label>Entrada<input type="datetime-local" value={retroStartAt} onChange={(event) => setRetroStartAt(event.target.value)} required /></label><label>Saída<input type="datetime-local" value={retroEndAt} onChange={(event) => setRetroEndAt(event.target.value)} required /></label></div>
      <div className="shift-model-grid">{retroDrafts.map((draft) => <section className="shift-model-panel" key={draft.key}>{modelSelector("retroactive", draft, retroDrafts)}<div className="retro-evidence-grid">{fields("retroactive", draft, "start", "início")}{fields("retroactive", draft, "end", "fim")}</div>{hasNegativeBalance(draft) ? <label>Justificativa para saldo negativo<textarea value={draft.negativeJustification} maxLength={500} required onChange={(event) => setRetroDrafts((current) => current.map((item) => item.key === draft.key ? { ...item, negativeJustification: event.target.value } : item))} /></label> : null}</section>)}</div>
      {retroDrafts.length < 2 && rooms.length > retroDrafts.length ? <button type="button" className="secondary-button add-model-button" onClick={() => addModel("retroactive")}>+ Adicionar segunda modelo</button> : null}
      {workflowError}
      <button className="primary-button" type="submit" disabled={submitting}>{submitting ? "Lançando…" : retroDrafts.length === 2 ? "Lançar os dois turnos" : "Lançar turno anterior"}</button>
    </form> : null}

    <ModalDialog open={confirmCancel} onClose={() => !submitting && setConfirmCancel(false)} ariaLabel="Cancelar ponto aberto"><h2>Cancelar {currentShifts.length === 2 ? "os pontos" : "o ponto"}?</h2><p>Os comprovantes serão removidos e a ação ficará registrada.</p><div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setConfirmCancel(false)} disabled={submitting}>Voltar</button><button className="danger-button" type="button" onClick={() => void cancelCurrentBatch()} disabled={submitting}>{submitting ? "Cancelando…" : "Confirmar cancelamento"}</button></div></ModalDialog>
  </section>;
};

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { CalendarDays, Clock3, RotateCcw } from "lucide-react";
import { Link } from "react-router-dom";
import { ImageDropzone } from "../components/ImageDropzone";
import { ModalDialog } from "../components/ModalDialog";
import { MoneyField } from "../components/MoneyField";
import { useToast } from "../components/Toast";
import { useAuth } from "../auth/AuthContext";
import { api } from "../lib/api";
import { normalizeApiError } from "../lib/apiError";
import { formatBusinessDate, formatDateTime, getBusinessDateTimeParts, legacyIsoFromLocalFields } from "../lib/dateTime";
import { formatBrl, parseMoneyInput } from "../lib/money";
import type { MoneyCurrency } from "../lib/money";
import type { FxRateResponse, OcrExtractResponse } from "../types/api";

type Shift = { id: string; batchId?: string | null; modelTagId: string; startedAt: string; startValueCents: number; startOriginalCurrency?: string | null; startOriginalAmountCents?: number | null; modelTag: { id: string; name: string } };
type Room = { id: string; name: string };
type ShiftMode = "live" | "retroactive";
type EvidenceSide = "start" | "end";
type DraftScope = "live" | "retroactive" | "closing";
type UploadStatus = "idle" | "uploading" | "ready" | "error";
type EvidenceDraft = {
  evidenceId: string; imageName: string; value: string; currency: MoneyCurrency; confidence: number | null;
  status: UploadStatus; attemptId: string; error: string; advisory: string;
};
type ModelDraft = { key: string; modelTagId: string; start: EvidenceDraft; end: EvidenceDraft; negativeJustification: string };
type ClosingDraft = ModelDraft & { shift: Shift };

const emptyEvidence = (): EvidenceDraft => ({ evidenceId: "", imageName: "", value: "", currency: "BRL", confidence: null, status: "idle", attemptId: "", error: "", advisory: "" });
const emptyModelDraft = (modelTagId = ""): ModelDraft => ({ key: crypto.randomUUID(), modelTagId, start: emptyEvidence(), end: emptyEvidence(), negativeJustification: "" });
const centsToMoneyInput = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
const extractImageFromClipboard = (clipboardData: DataTransfer | null): File | null => {
  if (!clipboardData) return null;
  const file = Array.from(clipboardData.files ?? []).find((candidate) => candidate.type.toLowerCase().startsWith("image/"));
  return file ?? Array.from(clipboardData.items ?? []).find((item) => item.type.toLowerCase().startsWith("image/"))?.getAsFile() ?? null;
};
const isTextEditingTarget = (target: EventTarget | null) => target instanceof HTMLElement
  && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
const hasNegativeBalance = (draft: ModelDraft) => {
  if (draft.start.currency !== draft.end.currency) return false;
  const start = parseMoneyInput(draft.start.value); const end = parseMoneyInput(draft.end.value);
  return start !== null && end !== null && end < start;
};
const formIso = (date: string, time: string) => legacyIsoFromLocalFields(date, time) ?? "";

const TimeCard = ({ title, summary, onUseNow, children }: { title: string; summary: string; onUseNow?: () => void; children: ReactNode }) => (
  <section className="shift-time-card">
    <div className="shift-time-card-heading">
      <span className="shift-time-icon" aria-hidden="true"><CalendarDays size={21} /></span>
      <div><h3>{title}</h3><p>{summary}</p></div>
    </div>
    <div className="shift-time-controls">{children}</div>
    {onUseNow ? <button type="button" className="time-now-button" onClick={onUseNow}><Clock3 size={17} aria-hidden="true" />Usar agora</button> : null}
  </section>
);

type ValueFieldsProps = {
  id: string; label: string; value: EvidenceDraft; active: boolean; onActivate: () => void;
  onFile: (file: File) => void; onChange: (patch: Partial<EvidenceDraft>) => void;
};
const ValueFields = ({ id, label, value, active, onActivate, onFile, onChange }: ValueFieldsProps) => (
  <div className="shift-value-fields">
    <ImageDropzone id={`${id}-image`} title={`Print do faturamento (${label})`} fileName={value.imageName}
      status={value.status} error={value.status === "error" ? value.error : null} advisory={value.advisory}
      active={active} onActivate={onActivate} onFile={onFile} />
    <MoneyField inputId={`${id}-value`} value={value.value} onValueChange={(next) => onChange({ value: next, error: "" })}
      currency={value.currency} onCurrencyChange={(currency) => onChange({ currency, error: "" })}
      confidence={value.confidence} reading={value.status === "uploading"}
      error={value.status !== "error" ? value.error : null} />
  </div>
);

export const ShiftsPage = () => {
  const { user } = useAuth(); const toast = useToast();
  const [initial] = useState(() => {
    const instant = new Date();
    return {
      now: getBusinessDateTimeParts(instant),
      retroStart: getBusinessDateTimeParts(new Date(instant.getTime() - 2 * 60 * 60_000)),
      retroEnd: getBusinessDateTimeParts(new Date(instant.getTime() - 60 * 60_000))
    };
  });
  const initialNow = initial.now; const retroInitial = initial.retroStart; const retroEndInitial = initial.retroEnd;
  const [clock, setClock] = useState(() => new Date());
  const [rooms, setRooms] = useState<Room[]>([]); const [currentShifts, setCurrentShifts] = useState<Shift[]>([]);
  const [mode, setMode] = useState<ShiftMode>("live");
  const [liveDrafts, setLiveDrafts] = useState<ModelDraft[]>([emptyModelDraft()]);
  const [retroDrafts, setRetroDrafts] = useState<ModelDraft[]>([emptyModelDraft()]);
  const [closingDrafts, setClosingDrafts] = useState<ClosingDraft[]>([]);
  const [liveDate] = useState(initialNow.date); const [liveTime, setLiveTime] = useState(initialNow.time);
  const [retroDate, setRetroDate] = useState(retroInitial.date === retroEndInitial.date ? retroInitial.date : initialNow.date);
  const [retroStartTime, setRetroStartTime] = useState(retroInitial.date === retroEndInitial.date ? retroInitial.time : "00:00");
  const [retroEndTime, setRetroEndTime] = useState(retroInitial.date === retroEndInitial.date ? retroEndInitial.time : initialNow.time);
  const [closeTime, setCloseTime] = useState(initialNow.time); const [timeError, setTimeError] = useState("");
  const [pasteTarget, setPasteTarget] = useState<string | null>(null);
  const [workflowError, setWorkflowError] = useState<string | null>(null); const workflowErrorRef = useRef<HTMLDivElement>(null);
  const [loadError, setLoadError] = useState<string | null>(null); const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false); const [confirmCancel, setConfirmCancel] = useState(false);
  const [correctAfterCancel, setCorrectAfterCancel] = useState(false);
  const notificationsEnabled = typeof Notification !== "undefined" && Notification.permission === "granted";
  const now = getBusinessDateTimeParts(clock);

  useEffect(() => { const timer = window.setInterval(() => setClock(new Date()), 30_000); return () => window.clearInterval(timer); }, []);

  const extractWithOcr = useCallback(async (file: File) => {
    const formData = new FormData(); formData.append("image", file);
    return (await api.post<OcrExtractResponse>("/ocr/extract", formData)).data;
  }, []);

  const loadData = useCallback(async () => {
    setLoadError(null);
    try {
      const [roomResponse, shiftResponse] = await Promise.all([
        api.get<{ rooms: Room[] }>("/chat/rooms"), api.get<{ shifts?: Shift[]; shift?: Shift | null }>("/chatter/shifts/current")
      ]);
      const nextRooms = roomResponse.data.rooms;
      const nextShifts = shiftResponse.data.shifts ?? (shiftResponse.data.shift ? [shiftResponse.data.shift] : []);
      setRooms(nextRooms); setCurrentShifts(nextShifts);
      const fillModels = (drafts: ModelDraft[]) => drafts.map((draft, index) => ({ ...draft, modelTagId: draft.modelTagId || nextRooms[index]?.id || nextRooms[0]?.id || "" }));
      setLiveDrafts(fillModels); setRetroDrafts(fillModels);
      setClosingDrafts(nextShifts.map((shift) => {
        const currency: MoneyCurrency = shift.startOriginalCurrency === "USD" ? "USD" : "BRL";
        const cents = currency === "USD" ? shift.startOriginalAmountCents ?? shift.startValueCents : shift.startValueCents;
        return { ...emptyModelDraft(shift.modelTagId), key: shift.id, shift, start: { ...emptyEvidence(), value: centsToMoneyInput(cents), currency } };
      }));
    } catch (requestError: unknown) { setLoadError(normalizeApiError(requestError, "Não foi possível carregar seus turnos.").message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);
  useEffect(() => {
    if (!workflowError) return;
    const frame = window.requestAnimationFrame(() => workflowErrorRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [workflowError]);

  const setDraftEvidence = useCallback((scope: DraftScope, key: string, side: EvidenceSide, patch: Partial<EvidenceDraft>, expectedAttemptId?: string) => {
    const update = <T extends ModelDraft>(items: T[]) => items.map((item) => item.key === key && (!expectedAttemptId || item[side].attemptId === expectedAttemptId)
      ? { ...item, [side]: { ...item[side], ...patch } } : item);
    if (scope === "live") setLiveDrafts(update);
    if (scope === "retroactive") setRetroDrafts(update);
    if (scope === "closing") setClosingDrafts(update);
  }, []);

  const applyImage = useCallback(async (scope: DraftScope, key: string, side: EvidenceSide, file: File) => {
    const attemptId = crypto.randomUUID(); setWorkflowError(null);
    setDraftEvidence(scope, key, side, { imageName: file.name, evidenceId: "", confidence: null, status: "uploading", attemptId, error: "", advisory: "" });
    try {
      const ocr = await extractWithOcr(file);
      const advisory = ocr.ocrStatus === "UNAVAILABLE"
        ? "Imagem enviada, mas o OCR está indisponível. Preencha o valor manualmente."
        : !ocr.detectedValue ? "Imagem enviada, mas o valor não foi identificado. Preencha manualmente." : "";
      setDraftEvidence(scope, key, side, { evidenceId: ocr.evidence.id, value: ocr.detectedValue ?? "", confidence: ocr.confidence, status: "ready", error: "", advisory }, attemptId);
    } catch (requestError: unknown) {
      setDraftEvidence(scope, key, side, { evidenceId: "", status: "error", advisory: "", error: normalizeApiError(requestError, "Não foi possível enviar a imagem. Tente novamente.").message }, attemptId);
    }
  }, [extractWithOcr, setDraftEvidence]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (isTextEditingTarget(event.target) || !pasteTarget) return;
      const file = extractImageFromClipboard(event.clipboardData ?? null); if (!file) return;
      const [scope, key, side] = pasteTarget.split(":") as [DraftScope, string, EvidenceSide];
      event.preventDefault(); void applyImage(scope, key, side, file);
    };
    window.addEventListener("paste", onPaste); return () => window.removeEventListener("paste", onPaste);
  }, [applyImage, pasteTarget]);

  const resolveBrlValue = useCallback(async (draft: EvidenceDraft) => {
    const amount = parseMoneyInput(draft.value); if (amount === null) throw new Error("Preencha um valor válido.");
    if (draft.currency === "BRL") return { value: draft.value.trim(), moneyMetadata: { currency: "BRL" as const, originalAmountCents: Math.round(amount * 100) } };
    const response = await api.get<FxRateResponse>("/fx/usd-brl"); const rate = Number(response.data.rate);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error("Cotação USD/BRL indisponível.");
    return { value: formatBrl(amount * rate), moneyMetadata: { currency: "USD" as const, originalAmountCents: Math.round(amount * 100), fxRate: rate, fxProvider: response.data.provider ?? "AwesomeAPI", fxQuotedAt: response.data.quotedAt ?? new Date().toISOString() } };
  }, []);
  const valuePayload = useCallback(async (draft: EvidenceDraft) => {
    const resolved = await resolveBrlValue(draft);
    return { evidenceId: draft.evidenceId, ocrConfidence: draft.confidence ?? undefined, ocrDetectedValue: resolved.value, manualConfirmedValue: resolved.value, moneyMetadata: resolved.moneyMetadata };
  }, [resolveBrlValue]);

  const draftsFor = (scope: DraftScope) => scope === "live" ? liveDrafts : scope === "retroactive" ? retroDrafts : closingDrafts;
  const validateDrafts = (scope: DraftScope, sides: EvidenceSide[]) => {
    const drafts = draftsFor(scope); let firstInvalid = ""; let valid = true;
    for (const draft of drafts) for (const side of sides) {
      const evidence = draft[side]; const model = rooms.find((room) => room.id === draft.modelTagId)?.name ?? draft.modelTagId;
      let imageError = ""; let valueError = "";
      if (evidence.status === "uploading") imageError = `Aguarde o envio da imagem de ${side === "start" ? "entrada" : "saída"} de ${model}.`;
      else if (!evidence.evidenceId) imageError = `Envie a imagem de ${side === "start" ? "entrada" : "saída"} de ${model}.`;
      if (parseMoneyInput(evidence.value) === null) valueError = `Preencha um valor válido para ${model}.`;
      const error = imageError || valueError; setDraftEvidence(scope, draft.key, side, { error });
      if (error && !firstInvalid) firstInvalid = evidence.evidenceId && !imageError ? `evidence-${scope}-${draft.key}-${side}-value` : `evidence-${scope}-${draft.key}-${side}-image`;
      valid = valid && !error;
    }
    if (firstInvalid) window.requestAnimationFrame(() => document.getElementById(firstInvalid)?.focus());
    return valid;
  };

  const addModel = (scope: "live" | "retroactive") => {
    const drafts = scope === "live" ? liveDrafts : retroDrafts;
    const nextRoom = rooms.find((room) => !drafts.some((draft) => draft.modelTagId === room.id));
    if (!nextRoom || drafts.length >= 2) return;
    (scope === "live" ? setLiveDrafts : setRetroDrafts)((current) => [...current, emptyModelDraft(nextRoom.id)]);
  };
  const removeModel = (scope: "live" | "retroactive", key: string) => (scope === "live" ? setLiveDrafts : setRetroDrafts)((current) => current.length > 1 ? current.filter((item) => item.key !== key) : current);
  const updateModel = (scope: "live" | "retroactive", key: string, modelTagId: string) => (scope === "live" ? setLiveDrafts : setRetroDrafts)((current) => current.map((item) => item.key === key ? { ...item, modelTagId } : item));
  const showActionError = (requestError: unknown, fallback: string) => {
    const normalized = normalizeApiError(requestError, fallback);
    if (["REQUEST_ERROR", "CONFLICT", "SHIFT_EXPIRED_OPEN", "SHIFT_START_TODAY_ONLY", "SHIFT_TIME_IN_FUTURE", "NOTIFICATIONS_REQUIRED"].includes(normalized.code)) setWorkflowError(normalized.message);
    else toast.error(normalized.message);
  };

  const validateTime = (kind: "live" | "close" | "retro") => {
    setTimeError(""); const current = getBusinessDateTimeParts(); let message = "";
    if (kind === "live" && (!liveTime || liveDate !== current.date || liveTime > current.time)) message = "Escolha um horário de hoje que não esteja no futuro.";
    if (kind === "close") {
      const started = currentShifts[0] ? getBusinessDateTimeParts(currentShifts[0].startedAt) : null;
      if (!closeTime || !started || closeTime <= started.time) message = "A saída precisa ser posterior ao horário de entrada.";
      else if (started.date === current.date && closeTime > current.time) message = "O horário de saída não pode estar no futuro.";
    }
    if (kind === "retro") {
      if (!retroDate || !retroStartTime || !retroEndTime) message = "Preencha a data e os dois horários.";
      else if (retroEndTime <= retroStartTime) message = "A saída precisa ser posterior à entrada no mesmo dia.";
      else if (retroDate > current.date || (retroDate === current.date && retroEndTime > current.time)) message = "O turno anterior não pode terminar no futuro.";
    }
    if (message) { setTimeError(message); window.requestAnimationFrame(() => document.getElementById(kind === "retro" ? "retro-start-time" : `${kind}-time`)?.focus()); }
    return !message;
  };

  const submitLiveStart = async (event: FormEvent) => {
    event.preventDefault(); setWorkflowError(null);
    if (!notificationsEnabled) { setWorkflowError("Ative as notificações nas Preferências antes de abrir o ponto."); return; }
    if (!validateTime("live") || !validateDrafts("live", ["start"])) return;
    setSubmitting(true);
    try {
      const shifts = await Promise.all(liveDrafts.map(async (draft) => ({ modelTagId: draft.modelTagId, ...(await valuePayload(draft.start)) })));
      await api.post("/chatter/shifts/start-batch", { startedAt: formIso(liveDate, liveTime), businessDate: liveDate, startedTime: liveTime, notificationsEnabled: true, shifts });
      toast.success(shifts.length === 2 ? "Pontos iniciados nas duas modelos." : "Ponto iniciado com sucesso.");
      setLiveDrafts([emptyModelDraft(rooms[0]?.id ?? "")]); await loadData();
    } catch (requestError: unknown) { showActionError(requestError, "Não foi possível iniciar o ponto."); }
    finally { setSubmitting(false); }
  };

  const submitClose = async (event: FormEvent) => {
    event.preventDefault(); setWorkflowError(null);
    if (!validateTime("close") || !validateDrafts("closing", ["end"])) return;
    setSubmitting(true);
    try {
      const date = getBusinessDateTimeParts(currentShifts[0].startedAt).date;
      const shifts = await Promise.all(closingDrafts.map(async (draft) => ({ shiftId: draft.shift.id, ...(await valuePayload(draft.end)), negativeJustification: draft.negativeJustification || undefined })));
      await api.post("/chatter/shifts/end-batch", { endedAt: formIso(date, closeTime), businessDate: date, endedTime: closeTime, shifts });
      toast.success(shifts.length === 2 ? "Pontos encerrados nas duas modelos." : "Ponto encerrado com sucesso."); await loadData();
    } catch (requestError: unknown) { showActionError(requestError, "Não foi possível encerrar o ponto."); }
    finally { setSubmitting(false); }
  };

  const submitRetroactive = async (event: FormEvent) => {
    event.preventDefault(); setWorkflowError(null);
    if (!validateTime("retro") || !validateDrafts("retroactive", ["start", "end"])) return;
    setSubmitting(true);
    try {
      const shifts = await Promise.all(retroDrafts.map(async (draft) => ({ modelTagId: draft.modelTagId, start: await valuePayload(draft.start), end: await valuePayload(draft.end), negativeJustification: draft.negativeJustification || undefined })));
      await api.post("/chatter/shifts/retroactive-batch", { startedAt: formIso(retroDate, retroStartTime), endedAt: formIso(retroDate, retroEndTime), businessDate: retroDate, startedTime: retroStartTime, endedTime: retroEndTime, shifts });
      toast.success(shifts.length === 2 ? "Turnos anteriores lançados nas duas modelos." : "Turno anterior lançado com sucesso.");
      setRetroDrafts([emptyModelDraft(rooms[0]?.id ?? "")]);
    } catch (requestError: unknown) { showActionError(requestError, "Não foi possível lançar o turno anterior."); }
    finally { setSubmitting(false); }
  };

  const cancelCurrentBatch = async () => {
    const originalShifts = currentShifts; setSubmitting(true);
    try {
      const batchId = originalShifts[0]?.batchId;
      if (batchId && originalShifts.every((shift) => shift.batchId === batchId)) await api.delete(`/chatter/shifts/batches/${batchId}`);
      else await Promise.all(originalShifts.map((shift) => api.delete(`/chatter/shifts/${shift.id}`)));
      setConfirmCancel(false); toast.success("Ponto aberto cancelado.");
      if (correctAfterCancel && originalShifts.length) {
        const started = getBusinessDateTimeParts(originalShifts[0].startedAt);
        setRetroDate(started.date); setRetroStartTime(started.time); setRetroEndTime("");
        setRetroDrafts(originalShifts.map((shift) => emptyModelDraft(shift.modelTagId))); setMode("retroactive");
      }
      await loadData();
    } catch (requestError: unknown) { toast.error(normalizeApiError(requestError, "Não foi possível cancelar o ponto.").message); }
    finally { setSubmitting(false); setCorrectAfterCancel(false); }
  };

  const closeMph = useMemo(() => closingDrafts.map((draft) => {
    if (draft.start.currency !== "BRL" || draft.end.currency !== "BRL") return null;
    const start = parseMoneyInput(draft.start.value); const end = parseMoneyInput(draft.end.value);
    const closeIso = legacyIsoFromLocalFields(getBusinessDateTimeParts(draft.shift.startedAt).date, closeTime);
    const hours = closeIso ? (new Date(closeIso).getTime() - new Date(draft.shift.startedAt).getTime()) / 3_600_000 : 0;
    return start !== null && end !== null && hours > 0 ? (end - start) / hours : null;
  }), [closeTime, closingDrafts]);

  if (user?.role === "MANAGER") return <section className="stack-gap"><div className="page-header"><div><h1>Horários</h1><p>Gerencie seus turnos</p></div></div><div className="card"><h2>Visão do gerente</h2><p>Use Equipe e Pagamentos para administrar a operação.</p></div></section>;
  if (loading) return <section className="stack-gap"><div className="page-header"><div><h1>Horários</h1></div></div><div className="card skeleton-list"><div className="skeleton" /><div className="skeleton" /></div></section>;
  if (loadError) return <section className="stack-gap"><div className="page-header"><div><h1>Horários</h1></div></div><div className="card load-error-state" role="alert"><h2>Não foi possível carregar seus turnos</h2><p>{loadError}</p><button className="secondary-button" onClick={() => { setLoading(true); void loadData(); }}><RotateCcw size={17} />Tentar novamente</button></div></section>;
  if (!rooms.length && !currentShifts.length) return <section className="stack-gap"><div className="page-header"><div><h1>Horários</h1></div></div><div className="card"><p className="empty-hint">Você ainda não possui uma modelo vinculada. Peça a um gerente para liberar uma.</p></div></section>;

  const currentStarted = currentShifts[0] ? getBusinessDateTimeParts(currentShifts[0].startedAt) : null;
  const expiredOpenShift = Boolean(currentStarted && currentStarted.date !== now.date);
  const anyUploading = [...liveDrafts, ...retroDrafts, ...closingDrafts].some((draft) => draft.start.status === "uploading" || draft.end.status === "uploading");
  const modelSelector = (scope: "live" | "retroactive", draft: ModelDraft, drafts: ModelDraft[]) => (
    <div className="shift-model-heading"><label>Modelo<select value={draft.modelTagId} onChange={(event) => updateModel(scope, draft.key, event.target.value)} required>
      {rooms.map((room) => <option key={room.id} value={room.id} disabled={drafts.some((item) => item.key !== draft.key && item.modelTagId === room.id)}>{room.name}</option>)}
    </select></label>{drafts.length > 1 ? <button type="button" className="secondary-button compact-button" onClick={() => removeModel(scope, draft.key)}>Remover</button> : null}</div>
  );
  const fields = (scope: DraftScope, draft: ModelDraft, side: EvidenceSide, label: string) => {
    const id = `evidence-${scope}-${draft.key}-${side}`;
    return <ValueFields id={id} label={label} value={draft[side]} active={pasteTarget === `${scope}:${draft.key}:${side}`}
      onActivate={() => setPasteTarget(`${scope}:${draft.key}:${side}`)} onFile={(file) => void applyImage(scope, draft.key, side, file)}
      onChange={(patch) => setDraftEvidence(scope, draft.key, side, patch)} />;
  };
  const formError = workflowError ? <div ref={workflowErrorRef} className="error-box shift-workflow-error" role="alert" tabIndex={-1}>{workflowError}</div> : null;

  return <section className="stack-gap shifts-page">
    <div className="page-header"><div><h1>Horários</h1><p>Registre pontos atuais ou lance um período anterior</p></div></div>
    <div className="shift-mode-switch segmented" role="group" aria-label="Tipo de lançamento">
      <button type="button" className={mode === "live" ? "active" : ""} aria-pressed={mode === "live"} onClick={() => { setMode("live"); setWorkflowError(null); setTimeError(""); }}>Abrir ponto</button>
      <button type="button" className={mode === "retroactive" ? "active" : ""} aria-pressed={mode === "retroactive"} onClick={() => { setMode("retroactive"); setWorkflowError(null); setTimeError(""); }}>Lançar turno anterior</button>
    </div>

    {mode === "live" && !currentShifts.length ? <form className="card form-grid shift-workflow-card" onSubmit={submitLiveStart} noValidate>
      <div className="section-header"><div><h2>Abrir ponto</h2><p>Uma ou duas modelos com o mesmo horário de entrada.</p></div></div>
      {!notificationsEnabled ? <div className="warning-box" role="alert">Ative as notificações em <Link to="/config">Preferências</Link> antes de abrir o ponto.</div> : null}
      <TimeCard title="Data e horário da entrada" summary={`Hoje, ${formatBusinessDate(liveDate)}, às ${liveTime || "--:--"}`} onUseNow={() => { const value = getBusinessDateTimeParts(); setLiveTime(value.time); setTimeError(""); }}>
        <div className="locked-date"><span>Data</span><strong>{formatBusinessDate(liveDate)}</strong><small>Hoje</small></div>
        <label>Horário<input id="live-time" type="time" step="60" value={liveTime} max={now.time} onChange={(event) => { setLiveTime(event.target.value); setTimeError(""); }} aria-invalid={Boolean(timeError)} /></label>
      </TimeCard>
      {timeError ? <p className="field-error time-error" role="alert">{timeError}</p> : null}
      <div className="shift-model-grid">{liveDrafts.map((draft) => <section className="shift-model-panel" key={draft.key}>{modelSelector("live", draft, liveDrafts)}{fields("live", draft, "start", "início")}</section>)}</div>
      {liveDrafts.length < 2 && rooms.length > liveDrafts.length ? <button type="button" className="secondary-button add-model-button" onClick={() => addModel("live")}>+ Adicionar segunda modelo</button> : null}
      {formError}
      <button className="primary-button" type="submit" disabled={submitting || anyUploading || !notificationsEnabled}>{submitting ? "Abrindo…" : liveDrafts.length === 2 ? "Abrir os dois pontos" : "Abrir ponto"}</button>
    </form> : null}

    {mode === "live" && currentShifts.length && expiredOpenShift ? <section className="card expired-shift-card" role="alert">
      <span className="expired-shift-icon" aria-hidden="true"><Clock3 size={24} /></span>
      <div><h2>Este ponto ficou aberto em outro dia</h2><p>Ele começou em <strong>{formatDateTime(currentShifts[0].startedAt)}</strong>. Para não misturar dias, cancele e relance o período correto como turno anterior.</p></div>
      <button type="button" className="primary-button" onClick={() => { setCorrectAfterCancel(true); setConfirmCancel(true); }}>Cancelar e corrigir</button>
    </section> : null}

    {mode === "live" && currentShifts.length && !expiredOpenShift ? <form className="card form-grid shift-workflow-card" onSubmit={submitClose} noValidate>
      <div className="section-header"><div><h2>Encerrar turno</h2><p>{currentShifts.length === 2 ? "As duas modelos serão encerradas juntas." : `Ponto aberto em ${currentShifts[0].modelTag.name}.`}</p></div></div>
      <TimeCard title="Data e horário da saída" summary={`Entrada às ${currentStarted?.time} • saída às ${closeTime || "--:--"}`} onUseNow={() => { setCloseTime(getBusinessDateTimeParts().time); setTimeError(""); }}>
        <div className="locked-date"><span>Data</span><strong>{formatBusinessDate(currentStarted!.date)}</strong><small>Mesmo dia da entrada</small></div>
        <label>Horário de saída<input id="close-time" type="time" step="60" min={currentStarted?.time} max={now.time} value={closeTime} onChange={(event) => { setCloseTime(event.target.value); setTimeError(""); }} aria-invalid={Boolean(timeError)} /></label>
      </TimeCard>
      {timeError ? <p className="field-error time-error" role="alert">{timeError}</p> : null}
      <div className="shift-model-grid">{closingDrafts.map((draft, index) => <section className="shift-model-panel" key={draft.key}>
        <div className="shift-model-heading"><div><span className="field-hint">Modelo</span><h3>{draft.shift.modelTag.name}</h3></div><span className="status-badge open">Em aberto</span></div>
        {fields("closing", draft, "end", "fim")}
        {closeMph[index] !== null ? <div className={`mph-chip ${closeMph[index]! < 0 ? "mph-negative" : ""}`}><span>MPH estimado</span><strong>{formatBrl(closeMph[index]!)}/h</strong></div> : null}
        {hasNegativeBalance(draft) ? <label>Justificativa para saldo negativo<textarea value={draft.negativeJustification} maxLength={500} required onChange={(event) => setClosingDrafts((current) => current.map((item) => item.key === draft.key ? { ...item, negativeJustification: event.target.value } : item))} /></label> : null}
      </section>)}</div>
      {formError}
      <div className="shift-close-actions" role="group" aria-label="Ações do ponto aberto"><button type="button" className="danger-button" onClick={() => { setCorrectAfterCancel(false); setConfirmCancel(true); }} disabled={submitting}>{currentShifts.length === 2 ? "Cancelar os dois pontos" : "Cancelar ponto"}</button><button className="primary-button" type="submit" disabled={submitting || anyUploading}>{submitting ? "Encerrando…" : currentShifts.length === 2 ? "Encerrar os dois pontos" : "Encerrar ponto"}</button></div>
    </form> : null}

    {mode === "retroactive" ? <form className="card form-grid shift-workflow-card" onSubmit={submitRetroactive} noValidate>
      <div className="section-header"><div><h2>Lançar turno anterior</h2><p>Escolha uma data única para a entrada e a saída.</p></div></div>
      <TimeCard title="Data e período do turno" summary={`${retroDate ? formatBusinessDate(retroDate) : "Escolha a data"} • ${retroStartTime || "--:--"} até ${retroEndTime || "--:--"}`} onUseNow={() => { const value = getBusinessDateTimeParts(); setRetroDate(value.date); setRetroEndTime(value.time); setTimeError(""); }}>
        <label>Data<input id="retro-date" type="date" value={retroDate} max={now.date} onChange={(event) => { setRetroDate(event.target.value); setTimeError(""); }} /></label>
        <label>Entrada<input id="retro-start-time" type="time" step="60" value={retroStartTime} onChange={(event) => { setRetroStartTime(event.target.value); setTimeError(""); }} /></label>
        <label>Saída<input id="retro-end-time" type="time" step="60" value={retroEndTime} onChange={(event) => { setRetroEndTime(event.target.value); setTimeError(""); }} /></label>
      </TimeCard>
      {timeError ? <p className="field-error time-error" role="alert">{timeError}</p> : null}
      <div className="shift-model-grid">{retroDrafts.map((draft) => <section className="shift-model-panel" key={draft.key}>{modelSelector("retroactive", draft, retroDrafts)}<div className="retro-evidence-grid">{fields("retroactive", draft, "start", "início")}{fields("retroactive", draft, "end", "fim")}</div>{hasNegativeBalance(draft) ? <label>Justificativa para saldo negativo<textarea value={draft.negativeJustification} maxLength={500} required onChange={(event) => setRetroDrafts((current) => current.map((item) => item.key === draft.key ? { ...item, negativeJustification: event.target.value } : item))} /></label> : null}</section>)}</div>
      {retroDrafts.length < 2 && rooms.length > retroDrafts.length ? <button type="button" className="secondary-button add-model-button" onClick={() => addModel("retroactive")}>+ Adicionar segunda modelo</button> : null}
      {formError}
      <button className="primary-button" type="submit" disabled={submitting || anyUploading}>{submitting ? "Lançando…" : retroDrafts.length === 2 ? "Lançar os dois turnos" : "Lançar turno anterior"}</button>
    </form> : null}

    <ModalDialog open={confirmCancel} onClose={() => !submitting && setConfirmCancel(false)} ariaLabel="Cancelar ponto aberto"><h2>{correctAfterCancel ? "Cancelar e corrigir o ponto?" : `Cancelar ${currentShifts.length === 2 ? "os pontos" : "o ponto"}?`}</h2><p>{correctAfterCancel ? "Você será levado ao lançamento anterior com a data e a entrada preenchidas. Será necessário reenviar os comprovantes." : "Os comprovantes serão removidos e o cancelamento ficará registrado no chat."}</p><div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setConfirmCancel(false)} disabled={submitting}>Voltar</button><button className="danger-button" type="button" onClick={() => void cancelCurrentBatch()} disabled={submitting}>{submitting ? "Cancelando…" : "Confirmar cancelamento"}</button></div></ModalDialog>
  </section>;
};

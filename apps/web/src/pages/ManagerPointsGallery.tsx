import { useEffect, useState } from "react";
import { Clock3, Eye, Filter } from "lucide-react";
import type { Pagination, PaymentPeriod } from "@lumas/contracts";
import { api } from "../lib/api";
import { formatDateTime } from "../lib/dateTime";
import { getApiErrorMessage } from "../lib/apiError";
import { EvidenceLink } from "../components/EvidenceLink";
import { ModalDialog } from "../components/ModalDialog";
import type { EvidenceSummary } from "../types/api";
import { PaymentPeriodIndicator } from "../components/PaymentPeriodIndicator";

type Option = { id: string; displayName?: string; name?: string };
type GalleryShift = {
  id: string;
  state: "OPEN" | "PENDING" | "CONFIRMED" | "PAID";
  chatter: { id: string; displayName: string };
  modelTag: { id: string; name: string };
  startedAt: string;
  endedAt: string | null;
  startValueFormatted: string;
  endValueFormatted: string | null;
  grossAmountFormatted: string | null;
  payoutAmountFormatted: string | null;
  paymentPeriod: PaymentPeriod;
  negativeJustification: string | null;
  notes: string | null;
  startEvidence?: EvidenceSummary | null;
  endEvidence?: EvidenceSummary | null;
};

const emptyPagination: Pagination = { page: 1, pageSize: 12, total: 0, totalPages: 1 };
const stateLabel: Record<GalleryShift["state"], string> = {
  OPEN: "Em andamento", PENDING: "Aguardando confirmação", CONFIRMED: "Confirmado", PAID: "Pago"
};

export const ManagerPointsGallery = () => {
  const [date, setDate] = useState("");
  const [chatterId, setChatterId] = useState("");
  const [modelTagId, setModelTagId] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<GalleryShift[]>([]);
  const [chatters, setChatters] = useState<Option[]>([]);
  const [tags, setTags] = useState<Option[]>([]);
  const [pagination, setPagination] = useState<Pagination>(emptyPagination);
  const [selected, setSelected] = useState<GalleryShift | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([
      api.get("/manager/chatters", { params: { page: 1, pageSize: 100 } }),
      api.get("/manager/tags", { params: { page: 1, pageSize: 100 } })
    ]).then(([chatterResponse, tagResponse]) => {
      setChatters(chatterResponse.data.items ?? []);
      setTags(tagResponse.data.items ?? tagResponse.data.tags ?? []);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    setLoading(true); setError(null);
    void api.get("/manager/shifts", { params: {
      page, pageSize: 12, businessDate: date || undefined,
      chatterId: chatterId || undefined, modelTagId: modelTagId || undefined, status
    } }).then((response) => {
      setItems(response.data.items); setPagination(response.data.pagination);
    }).catch((requestError: unknown) => setError(getApiErrorMessage(requestError, "Não foi possível carregar os pontos.")))
      .finally(() => setLoading(false));
  }, [chatterId, date, modelTagId, page, status]);

  const changeFilter = (setter: (value: string) => void, value: string) => { setter(value); setPage(1); };

  return <div className="stack-gap points-gallery-panel">
    <div className="card points-gallery-filters" aria-label="Filtros dos pontos">
      <span className="eyebrow"><Filter size={15} /> Filtros</span>
      <label>Data<input type="date" value={date} onChange={(event) => changeFilter(setDate, event.target.value)} /></label>
      <label>Chatter<select value={chatterId} onChange={(event) => changeFilter(setChatterId, event.target.value)}><option value="">Todos</option>{chatters.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
      <label>Modelo<select value={modelTagId} onChange={(event) => changeFilter(setModelTagId, event.target.value)}><option value="">Todas</option>{tags.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Estado<select value={status} onChange={(event) => changeFilter(setStatus, event.target.value)}><option value="all">Todos</option><option value="OPEN">Em andamento</option><option value="PENDING">Aguardando confirmação</option><option value="CONFIRMED">Confirmado</option><option value="PAID">Pago</option></select></label>
    </div>
    {error ? <div className="error-box" role="alert">{error}</div> : null}
    {loading ? <div className="points-gallery-grid" aria-label="Carregando pontos">{Array.from({ length: 4 }, (_, index) => <div className="card skeleton points-gallery-skeleton" key={index} />)}</div> : null}
    {!loading ? <div className="points-gallery-grid">{items.map((shift) => <article className="card point-gallery-card" key={shift.id}>
      <header><div><span className="eyebrow">{shift.chatter.displayName}</span><h3>{shift.modelTag.name}</h3></div><span className={`status-badge point-state-${shift.state.toLowerCase()}`}>{stateLabel[shift.state]}</span></header>
      <div className="point-gallery-times"><Clock3 size={16} /><span>{formatDateTime(shift.startedAt)}{shift.endedAt ? ` — ${formatDateTime(shift.endedAt)}` : " — agora"}</span></div>
      <PaymentPeriodIndicator period={shift.paymentPeriod} compact />
      <dl><div><dt>Inicial</dt><dd>{shift.startValueFormatted}</dd></div><div><dt>Final</dt><dd>{shift.endValueFormatted ?? "—"}</dd></div><div><dt>Bruto</dt><dd>{shift.grossAmountFormatted ?? "—"}</dd></div><div><dt>Comissão</dt><dd>{shift.payoutAmountFormatted ?? "—"}</dd></div></dl>
      <button className="secondary-button" type="button" onClick={() => setSelected(shift)}><Eye size={16} /> Ver detalhes</button>
    </article>)}</div> : null}
    {!loading && !items.length ? <div className="card empty-hint">Nenhum ponto encontrado para os filtros selecionados.</div> : null}
    {pagination.totalPages > 1 ? <div className="pagination"><button className="secondary-button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button><span>Página {pagination.page} de {pagination.totalPages}</span><button className="secondary-button" disabled={page >= pagination.totalPages} onClick={() => setPage(page + 1)}>Próxima</button></div> : null}
    <ModalDialog open={Boolean(selected)} onClose={() => setSelected(null)} ariaLabel="Detalhes do ponto" panelClassName="modal modal-solid point-gallery-modal">{selected ? <>
      <div><span className="eyebrow">{selected.chatter.displayName}</span><h2>{selected.modelTag.name}</h2></div>
      <span className={`status-badge point-state-${selected.state.toLowerCase()}`}>{stateLabel[selected.state]}</span>
      <PaymentPeriodIndicator period={selected.paymentPeriod} />
      <div className="point-detail-grid"><div><span>Início</span><strong>{formatDateTime(selected.startedAt)}</strong></div><div><span>Fim</span><strong>{selected.endedAt ? formatDateTime(selected.endedAt) : "Em andamento"}</strong></div><div><span>Valor inicial</span><strong>{selected.startValueFormatted}</strong></div><div><span>Valor final</span><strong>{selected.endValueFormatted ?? "—"}</strong></div><div><span>Bruto</span><strong>{selected.grossAmountFormatted ?? "—"}</strong></div><div><span>Comissão</span><strong>{selected.payoutAmountFormatted ?? "—"}</strong></div></div>
      <div><span className="field-hint">Capturas</span><div className="evidence-pair"><EvidenceLink evidence={selected.startEvidence} /><EvidenceLink evidence={selected.endEvidence} /></div></div>
      {selected.negativeJustification ? <div className="warning-box"><strong>Justificativa</strong><p>{selected.negativeJustification}</p></div> : null}
      {selected.notes ? <div><span className="field-hint">Observações</span><p>{selected.notes}</p></div> : null}
      <div className="modal-actions"><button className="primary-button" type="button" onClick={() => setSelected(null)}>Fechar</button></div>
    </> : null}</ModalDialog>
  </div>;
};

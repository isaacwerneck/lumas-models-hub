import { useEffect, useState } from "react";
import { Eye, ImageOff, RotateCcw, X, ZoomIn, ZoomOut } from "lucide-react";
import type { EvidenceSummary } from "../types/api";
import { api } from "../lib/api";
import { getApiErrorMessage } from "../lib/apiError";
import { useToast } from "./Toast";
import { ModalDialog } from "./ModalDialog";

export const EvidenceLink = ({ evidence, fallbackName }: { evidence?: EvidenceSummary | null; fallbackName?: string | null }) => {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [zoom, setZoom] = useState(1);
  const toast = useToast();

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  if (!evidence || evidence.status === "MISSING_LEGACY") {
    return <span className="evidence-unavailable" title={fallbackName ?? undefined}><ImageOff size={15} /> Legado indisponível</span>;
  }
  if (evidence.status === "PURGED" || evidence.status === "PURGE_PENDING") {
    return <span className="evidence-unavailable"><ImageOff size={15} /> {evidence.status === "PURGED" ? "Removido após pagamento" : "Em limpeza"}</span>;
  }

  const openPreview = async () => {
    setLoading(true);
    try {
      const response = await api.get(`/evidence/${evidence.id}/content`, { responseType: "blob" });
      setZoom(1);
      setPreviewUrl(URL.createObjectURL(response.data));
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Não foi possível abrir o comprovante."));
    } finally {
      setLoading(false);
    }
  };

  return <>
    <button type="button" className="evidence-link" onClick={() => void openPreview()} disabled={loading}><Eye size={15} /> {loading ? "Abrindo…" : evidence.originalName}</button>
    <ModalDialog
      open={Boolean(previewUrl)}
      onClose={() => setPreviewUrl(null)}
      ariaLabel={`Comprovante ${evidence.originalName}`}
      overlayClassName="modal-overlay evidence-preview"
      panelClassName="evidence-preview-card"
    >
      {previewUrl ? <>
        <div className="drawer-heading evidence-preview-toolbar"><strong>{evidence.originalName}</strong><div><button type="button" className="icon-button" onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))} aria-label="Diminuir zoom"><ZoomOut size={20} /></button><span>{Math.round(zoom * 100)}%</span><button type="button" className="icon-button" onClick={() => setZoom((value) => Math.min(4, value + 0.25))} aria-label="Aumentar zoom"><ZoomIn size={20} /></button><button type="button" className="icon-button" onClick={() => setZoom(1)} aria-label="Restaurar zoom"><RotateCcw size={19} /></button><button type="button" className="icon-button" onClick={() => setPreviewUrl(null)} aria-label="Fechar"><X size={20} /></button></div></div>
        <div className="evidence-preview-canvas"><img style={{ transform: `scale(${zoom})` }} src={previewUrl} alt={`Comprovante ${evidence.originalName}`} /></div>
      </> : null}
    </ModalDialog>
  </>;
};

import { MessageCircle, Sheet } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { ChatPage } from "./ChatPage";
import { ModelWorksheetPage } from "./ModelWorksheetPage";

export const ModelWorkspacePage = () => {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "personalizados" ? "personalizados" : "chat";
  return <section className="stack-gap model-workspace"><div className="page-header"><div><h1>Central do modelo</h1><p>Conversa e controles de personalizados no mesmo espaço.</p></div></div><div className="workspace-tabs" role="tablist"><button role="tab" aria-selected={tab === "chat"} className={tab === "chat" ? "active" : ""} onClick={() => setParams({ tab: "chat" })}><MessageCircle size={18} /> Chat</button><button role="tab" aria-selected={tab === "personalizados"} className={tab === "personalizados" ? "active" : ""} onClick={() => setParams({ tab: "personalizados" })}><Sheet size={18} /> Personalizados</button></div><div className="workspace-panel">{tab === "chat" ? <ChatPage /> : <ModelWorksheetPage />}</div></section>;
};

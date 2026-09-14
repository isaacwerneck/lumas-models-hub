import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EvidenceLink } from "../components/EvidenceLink";
import { ImageDropzone } from "../components/ImageDropzone";
import { MoneyField } from "../components/MoneyField";
import { ToastProvider } from "../components/Toast";
import type { MoneyCurrency } from "../lib/money";
import type { EvidenceSummary } from "../types/api";

const apiMocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../lib/api", () => ({ api: apiMocks }));

const evidence = {
  id: "evidence-1",
  originalName: "captura.webp",
  status: "AVAILABLE"
} as EvidenceSummary;

const MoneyHarness = () => {
  const [value, setValue] = useState("10.00");
  const [currency, setCurrency] = useState<MoneyCurrency>("USD");
  return (
    <MoneyField
      value={value}
      onValueChange={setValue}
      currency={currency}
      onCurrencyChange={setCurrency}
      confidence={0.42}
      inputId="gross-value"
      error="Confira o valor"
    />
  );
};

describe("componentes de entrada e comprovantes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:preview") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  });

  afterEach(() => cleanup());

  it("aceita seleção, teclado, arraste e descarte de imagem", () => {
    const onFile = vi.fn();
    const onActivate = vi.fn();
    const { container } = render(
      <ImageDropzone
        id="proof"
        title="Comprovante"
        fileName={null}
        status="idle"
        advisory="PNG ou WebP"
        onFile={onFile}
        onActivate={onActivate}
      />
    );
    const zone = screen.getByRole("button", { name: /Comprovante/ });
    const input = container.querySelector("input[type=file]") as HTMLInputElement;
    const click = vi.spyOn(input, "click").mockImplementation(() => undefined);
    const image = new File(["image"], "proof.png", { type: "image/png" });

    fireEvent.click(zone);
    fireEvent.focus(zone);
    fireEvent.keyDown(zone, { key: "Enter" });
    fireEvent.keyDown(zone, { key: " " });
    fireEvent.dragOver(zone, { dataTransfer: { files: [], dropEffect: "none" } });
    fireEvent.drop(zone, { dataTransfer: { files: [new File(["x"], "note.txt", { type: "text/plain" }), image] } });
    fireEvent.change(input, { target: { files: [image] } });

    expect(click).toHaveBeenCalledTimes(3);
    expect(onActivate).toHaveBeenCalled();
    expect(onFile).toHaveBeenCalledTimes(2);
    expect(zone).toHaveAttribute("aria-describedby", "proof-feedback");
  });

  it("exibe estados de envio, sucesso e erro da área de imagem", () => {
    const { rerender } = render(
      <ImageDropzone title="Foto" fileName="foto.png" status="uploading" onFile={() => undefined} />
    );
    expect(screen.getByText("Enviando e lendo o valor…")).toBeInTheDocument();
    rerender(<ImageDropzone title="Foto" fileName="foto.png" status="ready" onFile={() => undefined} />);
    expect(screen.getByText("Imagem enviada — clique para trocar")).toBeInTheDocument();
    rerender(<ImageDropzone title="Foto" fileName="foto.png" status="error" error="Arquivo inválido" onFile={() => undefined} />);
    expect(screen.getByText("Arquivo inválido")).toBeInTheDocument();
  });

  it("carrega câmbio, mostra validação e permite editar moeda e valor", async () => {
    apiMocks.get.mockResolvedValue({ data: { rate: "5.0000" } });
    render(<MoneyHarness />);

    expect(screen.getByRole("alert")).toHaveTextContent("Confira o valor");
    expect(screen.getByText(/Confiança baixa do OCR/)).toBeInTheDocument();
    expect(await screen.findByText(/R\$ 50,00/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "R$" }));
    fireEvent.change(screen.getByLabelText("Valor do faturamento"), { target: { value: "25,00" } });
    fireEvent.click(screen.getByRole("button", { name: "US$" }));
    expect(screen.getByLabelText("Valor do faturamento")).toHaveValue("25,00");
  });

  it("abre comprovante, controla zoom, fecha e revoga a URL temporária", async () => {
    apiMocks.get.mockResolvedValue({ data: new Blob(["image"], { type: "image/webp" }) });
    render(<ToastProvider><EvidenceLink evidence={evidence} /></ToastProvider>);

    fireEvent.click(screen.getByRole("button", { name: /captura.webp/ }));
    expect(await screen.findByRole("dialog", { name: "Comprovante captura.webp" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Aumentar zoom" }));
    expect(screen.getByText("125%")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Diminuir zoom" }));
    fireEvent.click(screen.getByRole("button", { name: "Restaurar zoom" }));
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Comprovante captura.webp" })).not.toBeInTheDocument());
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview"));
  });

  it("informa falha ao abrir e representa comprovantes indisponíveis", async () => {
    apiMocks.get.mockRejectedValue(new Error("offline"));
    const { rerender } = render(<ToastProvider><EvidenceLink evidence={evidence} /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: /captura.webp/ }));
    expect(await screen.findByText("offline")).toBeInTheDocument();

    rerender(<ToastProvider><EvidenceLink evidence={null} fallbackName="antigo.png" /></ToastProvider>);
    expect(screen.getByText("Legado indisponível")).toHaveAttribute("title", "antigo.png");
    rerender(<ToastProvider><EvidenceLink evidence={{ ...evidence, status: "PURGED" }} /></ToastProvider>);
    expect(screen.getByText("Removido após pagamento")).toBeInTheDocument();
    rerender(<ToastProvider><EvidenceLink evidence={{ ...evidence, status: "PURGE_PENDING" }} /></ToastProvider>);
    expect(screen.getByText("Em limpeza")).toBeInTheDocument();
  });
});

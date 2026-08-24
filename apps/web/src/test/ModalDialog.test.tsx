import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModalDialog } from "../components/ModalDialog";

const DialogHarness = ({ onClose }: { onClose: () => void }) => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Abrir</button>
      <ModalDialog
        open={open}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
        ariaLabel="Confirmação"
      >
        <button type="button">Primeira ação</button>
        <button type="button">Última ação</button>
      </ModalDialog>
    </>
  );
};

describe("ModalDialog", () => {
  afterEach(() => cleanup());

  it("fecha com Escape, bloqueia a rolagem e devolve o foco ao acionador", async () => {
    const onClose = vi.fn();
    render(<DialogHarness onClose={onClose} />);
    const trigger = screen.getByRole("button", { name: "Abrir" });

    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Confirmação" })).toBeInTheDocument();
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(document.body.style.overflow).toBe(""));
    expect(trigger).toHaveFocus();
  });

  it("mantém Tab e Shift+Tab dentro do diálogo", async () => {
    render(<DialogHarness onClose={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir" }));
    const first = screen.getByRole("button", { name: "Primeira ação" });
    const last = screen.getByRole("button", { name: "Última ação" });

    await waitFor(() => expect(first).toHaveFocus());
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(first).toHaveFocus();
    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
  });

  it("renderiza fora de containers com overflow para não cortar pré-visualizações", () => {
    render(
      <div style={{ overflow: "hidden", transform: "translateZ(0)" }}>
        <ModalDialog open onClose={() => undefined} ariaLabel="Visualizador">
          <span>Conteúdo</span>
        </ModalDialog>
      </div>
    );

    const dialog = screen.getByRole("dialog", { name: "Visualizador" });
    expect(dialog.closest(".modal-overlay")?.parentElement).toBe(document.body);
  });
});

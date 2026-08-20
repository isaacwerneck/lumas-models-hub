import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ToastProvider, useToast } from "../components/Toast";

const Trigger = () => {
  const toast = useToast();
  return (
    <>
      <button type="button" onClick={() => toast.success("Alteração salva")}>Sucesso</button>
      <button type="button" onClick={() => toast.error("Não foi possível salvar")}>Erro</button>
    </>
  );
};

describe("ToastProvider", () => {
  it("exibe feedback das mutações e o remove automaticamente", async () => {
    render(<ToastProvider duration={20}><Trigger /></ToastProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Sucesso" }));
    fireEvent.click(screen.getByRole("button", { name: "Erro" }));
    expect(screen.getByText("Alteração salva")).toHaveClass("toast-success");
    expect(screen.getByText("Não foi possível salvar")).toHaveClass("toast-error");

    await waitFor(() => expect(screen.queryByText("Alteração salva")).not.toBeInTheDocument());
    expect(screen.queryByText("Não foi possível salvar")).not.toBeInTheDocument();
  });
});

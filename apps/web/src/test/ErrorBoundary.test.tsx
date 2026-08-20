import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "../components/ErrorBoundary";

const BrokenView = () => {
  throw new Error("falha inesperada");
};

describe("ErrorBoundary", () => {
  afterEach(() => vi.restoreAllMocks());

  it("substitui uma tela quebrada por uma recuperação orientativa", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<ErrorBoundary><BrokenView /></ErrorBoundary>);

    expect(screen.getByRole("heading", { name: "Algo deu errado" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recarregar" })).toBeInTheDocument();
  });
});

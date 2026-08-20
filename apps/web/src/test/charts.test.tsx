import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AreaChart } from "../components/charts/AreaChart";
import { BarList } from "../components/charts/BarList";
import { Donut } from "../components/charts/Donut";
import { Sparkline } from "../components/charts/Sparkline";

describe("gráficos acessíveis", () => {
  it("renderiza donut com totais, cores e cenário zerado", () => {
    const { rerender } = render(<Donut items={[
      { label: "Annie", value: 30, color: "#f0f" },
      { label: "Bella", value: 70, color: "#0ff" }
    ]} formatValue={(value) => `R$ ${value}`} />);
    expect(screen.getByRole("img", { name: "Distribuição" })).toBeInTheDocument();
    expect(screen.getByText("R$ 100")).toBeInTheDocument();
    expect(screen.getByText("R$ 30")).toBeInTheDocument();
    rerender(<Donut items={[{ label: "Sem produção", value: 0, color: "#aaa" }]} />);
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
  });

  it("limita e escala barras e orienta quando não há dados", () => {
    const { rerender } = render(<BarList maxItems={1} items={[
      { label: "Primeiro", value: 50, sub: "2 turnos", color: "red" },
      { label: "Segundo", value: 25 }
    ]} formatValue={(value) => `${value}%`} />);
    expect(screen.getByText("Primeiro")).toBeInTheDocument();
    expect(screen.queryByText("Segundo")).not.toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    rerender(<BarList items={[]} />);
    expect(screen.getByText("Sem dados no período.")).toBeInTheDocument();
  });

  it("desenha área para séries válidas e ignora série de um ponto", () => {
    const { container, rerender } = render(<AreaChart
      labels={["19/08", "20/08"]}
      series={[{ name: "Bruto", values: [0, 500], color: "#f0f" }]}
      formatValue={(value) => `R$ ${value}`}
    />);
    expect(screen.getByRole("img", { name: "Gráfico de tendência" })).toBeInTheDocument();
    expect(container.querySelectorAll("path")).toHaveLength(2);
    rerender(<AreaChart labels={["Hoje"]} series={[{ name: "Único", values: [10], color: "blue" }]} />);
    expect(container.querySelectorAll("path")).toHaveLength(0);
  });

  it("desenha sparkline e fornece fallback para menos de dois valores", () => {
    const { container, rerender } = render(<Sparkline values={[5, 5, 10, -2]} />);
    expect(container.querySelectorAll("path")).toHaveLength(2);
    expect(container.querySelector("circle")).toBeInTheDocument();
    rerender(<Sparkline values={[1]} width={80} height={20} />);
    expect(container.querySelectorAll("path")).toHaveLength(0);
  });
});

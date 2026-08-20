import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MphRankingPage } from "../pages/MphRankingPage";
import { renderWithQuery } from "./renderWithQuery";

const apiMocks = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("../lib/api", () => ({ api: apiMocks }));
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ user: { id: "chatter-1", role: "CHATTER" } })
}));

describe("MphRankingPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("mostra quantos lançamentos foram agregados por chatter", async () => {
    apiMocks.get.mockResolvedValue({ data: {
      window: "month",
      ranking: [{
        chatter: { id: "chatter-1", displayName: "Isaac", username: "isaac", isActive: true },
        shiftCount: 2,
        totalGrossCents: 27349,
        totalGrossFormatted: "R$ 273,49",
        totalHoursMs: 10_860_000,
        totalHoursFormatted: "3h 1m",
        mphCentsPerHour: 9065.96,
        mphFormatted: "R$ 90,66/h"
      }]
    } });

    renderWithQuery(<MphRankingPage />);

    expect(await screen.findByRole("columnheader", { name: "Lançamentos" })).toBeInTheDocument();
    expect(await screen.findByRole("cell", { name: "2" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "R$ 273,49" })).toBeInTheDocument();
  });
});

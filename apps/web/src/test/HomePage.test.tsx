import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HomePage } from "../pages/HomePage";

const mocks = vi.hoisted(() => {
  const socketOn = vi.fn();
  const socketOff = vi.fn();
  const managerOn = vi.fn();
  const managerOff = vi.fn();
  const disconnect = vi.fn();
  const socket = { on: socketOn, off: socketOff, disconnect, io: { on: managerOn, off: managerOff } };
  return { get: vi.fn(), io: vi.fn(() => socket), socketOn, socketOff, managerOn, managerOff, disconnect };
});

vi.mock("socket.io-client", () => ({ io: mocks.io }));
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ user: { id: "manager-1", role: "MANAGER" } })
}));
vi.mock("../lib/api", () => ({
  api: { get: mocks.get },
  getAccessToken: () => "manager-token",
  downloadApiFile: vi.fn()
}));

const analytics = (hours: string, shiftCount: number) => ({
  summary: {
    totalGrossCents: shiftCount ? 22789 : 0,
    totalGrossFormatted: shiftCount ? "R$ 227,89" : "R$ 0,00",
    totalPayoutCents: shiftCount ? 5697 : 0,
    totalPayoutFormatted: shiftCount ? "R$ 56,97" : "R$ 0,00",
    totalHoursMs: shiftCount ? 10_800_000 : 0,
    totalHoursFormatted: hours,
    mphCentsPerHour: shiftCount ? 7596 : 0,
    mphFormatted: shiftCount ? "R$ 75,96/h" : "R$ 0,00/h",
    shiftCount
  },
  daily: [],
  byModel: [],
  byChatter: []
});

describe("HomePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    let analyticsCalls = 0;
    mocks.get.mockImplementation((url: string) => {
      if (url === "/manager/tags") return Promise.resolve({ data: { tags: [] } });
      if (url === "/manager/chatters") return Promise.resolve({ data: { chatters: [] } });
      analyticsCalls += 1;
      return Promise.resolve({ data: analytics(analyticsCalls === 1 ? "3h" : "0m", analyticsCalls === 1 ? 1 : 0) });
    });
  });

  it("recarrega os indicadores quando um lançamento muda em outra sessão", async () => {
    render(<HomePage />);

    expect(await screen.findByText("3h")).toBeInTheDocument();
    const analyticsHandler = mocks.socketOn.mock.calls.find(([event]) => event === "analytics:updated")?.[1];
    expect(analyticsHandler).toBeTypeOf("function");

    await act(async () => analyticsHandler());

    expect(await screen.findByText("0m")).toBeInTheDocument();
    expect(mocks.get.mock.calls.filter(([url]) => url === "/manager/analytics")).toHaveLength(2);
  });
});

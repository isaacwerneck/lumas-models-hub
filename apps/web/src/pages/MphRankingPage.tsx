import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import { api } from "../lib/api";
import { getApiErrorMessage } from "../lib/apiError";

type MphWindow = "month" | "week" | "all";

type RankingEntry = {
  chatter: { id: string; displayName: string; username: string; isActive: boolean };
  totalGrossCents: number;
  totalGrossFormatted: string;
  totalHoursMs: number;
  totalHoursFormatted: string;
  shiftCount: number;
  mphCentsPerHour: number;
  mphFormatted: string;
};

type RankingResponse = {
  window: MphWindow;
  ranking: RankingEntry[];
};

const WINDOW_LABELS: Record<MphWindow, string> = {
  month: "Mês atual",
  week: "Semana atual",
  all: "Desde sempre"
};

export const MphRankingPage = () => {
  const { user } = useAuth();
  const [window, setWindow] = useState<MphWindow>("month");
  const rankingQuery = useQuery({
    queryKey: ["mph-ranking", window],
    queryFn: async () => (await api.get<RankingResponse>("/mph/ranking", { params: { window } })).data,
    refetchOnWindowFocus: true
  });
  const ranking = rankingQuery.data?.ranking ?? [];
  const loading = rankingQuery.isPending;
  const error = rankingQuery.error ? getApiErrorMessage(rankingQuery.error, "Erro ao carregar ranking.") : null;

  return (
    <section className="stack-gap">
      <div className="page-header">
        <div>
          <h1>Funcionário do Mês</h1>
          <p>Ranking por MPH (mimo por hora)</p>
        </div>
      </div>

      <div className="segmented">
        {(Object.keys(WINDOW_LABELS) as MphWindow[]).map((option) => (
          <button
            key={option}
            type="button"
            className={option === window ? "active" : ""}
            aria-pressed={option === window}
            onClick={() => setWindow(option)}
          >
            {WINDOW_LABELS[option]}
          </button>
        ))}
      </div>

      <div className="card table-card" tabIndex={0} aria-label="Ranking por MPH">
        {loading ? <div className="skeleton-list" aria-label="Carregando ranking"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div> : null}
        {!loading ? <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Chatter</th>
              <th>Lançamentos</th>
              <th>Bruto</th>
              <th>Horas</th>
              <th>MPH</th>
            </tr>
          </thead>
          <tbody>
            {ranking.map((entry, index) => (
              <tr key={entry.chatter.id} className={entry.chatter.id === user?.id ? "row-highlight" : ""}>
                <td>{index + 1}</td>
                <td>
                  {entry.chatter.displayName}
                  {entry.chatter.id === user?.id ? <span className="you-chip">você</span> : null}
                </td>
                <td>{entry.shiftCount}</td>
                <td>{entry.totalGrossFormatted}</td>
                <td>{entry.totalHoursFormatted}</td>
                <td>
                  <strong>{entry.mphFormatted}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table> : null}

        {!loading && ranking.length === 0 ? (
          <p className="empty-hint">Nenhum turno fechado neste período.</p>
        ) : null}
      </div>

      {error ? <div className="error-box">{error}</div> : null}
    </section>
  );
};

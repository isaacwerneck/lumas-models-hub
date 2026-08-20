import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { useAuth } from "../auth/AuthContext";
import { api, downloadApiFile, getAccessToken } from "../lib/api";
import { Sparkline } from "../components/charts/Sparkline";
import { AreaChart } from "../components/charts/AreaChart";
import { BarList } from "../components/charts/BarList";
import { Donut } from "../components/charts/Donut";
import type { AnalyticsResponse } from "../types/api";

type QuickWindow = "today" | "week" | "month" | "all";
type Metric = "gross" | "payout" | "hours" | "mph";

const QUICK_WINDOWS: { key: QuickWindow; label: string }[] = [
  { key: "today", label: "Hoje" },
  { key: "week", label: "Semana" },
  { key: "month", label: "Mês" },
  { key: "all", label: "Tudo" }
];

const METRICS: { key: Metric; label: string; color: string }[] = [
  { key: "gross", label: "Bruto", color: "var(--metric-gross)" },
  { key: "payout", label: "Payout", color: "var(--metric-payout)" },
  { key: "hours", label: "Horas", color: "var(--metric-hours)" },
  { key: "mph", label: "MPH", color: "var(--metric-mph)" }
];

const MODEL_COLORS = ["#7c5cff", "#2f9e63", "#3b82f6", "#f59e0b", "#e11d48", "#14b8a6", "#8b5cf6", "#f97316"];
const ANALYTICS_UPDATED_EVENT = "analytics:updated";

const formatBrl = (cents: number) => `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;
const formatHours = (ms: number) => `${(ms / 3600000).toFixed(1).replace(".", ",")}h`;
const formatMph = (centsPerHour: number) => `R$ ${(centsPerHour / 100).toFixed(2).replace(".", ",")}/h`;

const todayAtStart = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

const windowRange = (window: QuickWindow): { from?: string; to?: string } => {
  if (window === "all") return {};
  const start = todayAtStart();
  let from = start;
  if (window === "week") {
    const day = start.getDay();
    from = new Date(start);
    from.setDate(start.getDate() - ((day + 6) % 7));
  }
  if (window === "month") {
    from = new Date(start.getFullYear(), start.getMonth(), 1);
  }
  const to = new Date(start);
  to.setDate(start.getDate() + 1);
  return { from: from.toISOString(), to: to.toISOString() };
};

export const HomePage = () => {
  const { user } = useAuth();
  const isManager = user?.role === "MANAGER";

  // ---- chatter view state ----
  const [pendingFormatted, setPendingFormatted] = useState("R$ 0,00");
  const [lifetimeFormatted, setLifetimeFormatted] = useState("R$ 0,00");

  // ---- manager view state ----
  const [window, setWindow] = useState<QuickWindow>("month");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [modelTagId, setModelTagId] = useState("");
  const [chatterId, setChatterId] = useState("");
  const [metric, setMetric] = useState<Metric>("gross");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [tags, setTags] = useState<{ id: string; name: string }[]>([]);
  const [chatters, setChatters] = useState<{ id: string; displayName: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const analyticsRequestId = useRef(0);

  // chatter view
  useEffect(() => {
    if (isManager || !user) return;
    void (async () => {
      try {
        const response = await api.get("/chatter/payment/summary");
        setPendingFormatted(response.data.pendingFormatted);
        setLifetimeFormatted(response.data.lifetimePaidFormatted);
      } catch {
        // mantem valores padrao
      }
    })();
  }, [isManager, user]);

  // load filter options (manager only)
  useEffect(() => {
    if (!isManager) return;
    void (async () => {
      try {
        const [tagsRes, chattersRes] = await Promise.all([
          api.get("/manager/tags"),
          api.get("/manager/chatters", { params: { page: 1, pageSize: 100 } })
        ]);
        setTags(tagsRes.data.tags.map((tag: { id: string; name: string }) => ({ id: tag.id, name: tag.name })));
        setChatters(chattersRes.data.chatters.map((chatter: { id: string; displayName: string }) => ({ id: chatter.id, displayName: chatter.displayName })));
      } catch {
        // filtros vazios
      }
    })();
  }, [isManager]);

  // build query params
  const params = useMemo(() => {
    const range = windowRange(window);
    const from = fromDate ? `${fromDate}T00:00:00.000Z` : range.from;
    const to = toDate ? `${toDate}T23:59:59.999Z` : range.to;
    const query: Record<string, string> = {};
    if (from) query.from = from;
    if (to) query.to = to;
    if (modelTagId) query.modelTagId = modelTagId;
    if (chatterId) query.chatterId = chatterId;
    return query;
  }, [window, fromDate, toDate, modelTagId, chatterId]);

  const loadAnalytics = useCallback(async (showLoading = false) => {
    if (!isManager) return;

    const requestId = ++analyticsRequestId.current;
    if (showLoading) {
      setLoading(true);
      setError(null);
    }

    try {
      const response = await api.get<AnalyticsResponse>("/manager/analytics", { params });
      if (requestId === analyticsRequestId.current) {
        setData(response.data);
        setError(null);
      }
    } catch (requestError: unknown) {
      if (showLoading && requestId === analyticsRequestId.current) {
        const apiError = requestError as { response?: { data?: { message?: string } } };
        setError(apiError?.response?.data?.message ?? "Erro ao carregar o dashboard.");
      }
    } finally {
      if (showLoading && requestId === analyticsRequestId.current) {
        setLoading(false);
      }
    }
  }, [isManager, params]);

  // Carga inicial e recarga quando os filtros mudam.
  useEffect(() => {
    void loadAnalytics(true);
    return () => {
      analyticsRequestId.current += 1;
    };
  }, [loadAnalytics]);

  // Mantém o dashboard sincronizado com alterações feitas por chatters em outras sessões.
  useEffect(() => {
    if (!isManager) return;

    const refresh = () => void loadAnalytics();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const timer = globalThis.setInterval(refresh, 60_000);
    globalThis.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    const token = getAccessToken();
    const socket = token
      ? io(import.meta.env.VITE_API_URL ?? "http://localhost:3333", {
          auth: { token },
          reconnection: true
        })
      : null;

    socket?.on(ANALYTICS_UPDATED_EVENT, refresh);
    socket?.io.on("reconnect", refresh);

    return () => {
      globalThis.clearInterval(timer);
      globalThis.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      socket?.off(ANALYTICS_UPDATED_EVENT, refresh);
      socket?.io.off("reconnect", refresh);
      socket?.disconnect();
    };
  }, [isManager, loadAnalytics]);

  const chatterView = (
      <div className="home-page-wrapper">
        <div className="page-header">
          <div>
            <h1>Início</h1>
            <p>Visão geral do seu painel</p>
          </div>
        </div>
        <div className="glass-dashboard">
          <div className="glass-grid">
            <div className="glass-card glass-kpi">
              <span>Saldo pendente</span>
              <strong>{pendingFormatted}</strong>
            </div>
            <div className="glass-card glass-kpi">
              <span>Total recebido na vida</span>
              <strong>{lifetimeFormatted}</strong>
            </div>
          </div>
        </div>
      </div>
  );

  const summary = data?.summary;
  const daily = useMemo(() => data?.daily ?? [], [data]);
  const activeFilters = fromDate || toDate || modelTagId || chatterId;

  // ---- metric-derived series ----
  const metricConfig = METRICS.find((m) => m.key === metric)!;

  const dailyValues = useMemo(() => {
    return daily.map((point) => {
      switch (metric) {
        case "gross":
          return point.grossCents;
        case "payout":
          return point.payoutCents;
        case "hours":
          return point.hoursMs;
        case "mph":
          return point.hoursMs > 0 ? point.grossCents / (point.hoursMs / 3600000) : 0;
      }
    });
  }, [daily, metric]);

  const formatMetricValue = (value: number) => {
    switch (metric) {
      case "gross":
      case "payout":
        return formatBrl(value);
      case "hours":
        return formatHours(value);
      case "mph":
        return formatMph(value);
    }
  };

  const dailyLabels = useMemo(() => daily.map((point) => point.date.slice(5)), [daily]);

  const kpiCards = useMemo(() => {
    if (!summary) return [];
    return [
      { label: "Produção bruta", value: summary.totalGrossFormatted, color: "#2f9e63" },
      { label: "Payout", value: summary.totalPayoutFormatted, color: "#7c5cff" },
      { label: "Horas", value: summary.totalHoursFormatted, color: "#3b82f6" },
      { label: "MPH", value: summary.mphFormatted, color: "#f59e0b" },
      { label: "Turnos", value: String(summary.shiftCount), color: "#14b8a6" }
    ];
  }, [summary]);

  const modelBarItems = useMemo(
    () =>
      (data?.byModel ?? []).map((row, index) => ({
        label: row.modelTag.name,
        value: metric === "gross" ? row.grossCents : metric === "payout" ? row.payoutCents : metric === "hours" ? row.hoursMs : row.mphCentsPerHour,
        sub: `${row.shiftCount} turnos`,
        color: MODEL_COLORS[index % MODEL_COLORS.length]
      })),
    [data, metric]
  );

  const chatterBarItems = useMemo(
    () =>
      (data?.byChatter ?? []).map((row) => ({
        label: row.chatter.displayName,
        value: metric === "gross" ? row.grossCents : metric === "payout" ? row.payoutCents : metric === "hours" ? row.hoursMs : row.mphCentsPerHour,
        sub: row.mphFormatted,
        color: "#7c5cff"
      })),
    [data, metric]
  );

  const donutItems = useMemo(
    () =>
      (data?.byModel ?? []).map((row, index) => ({
        label: row.modelTag.name,
        value: row.payoutCents,
        color: MODEL_COLORS[index % MODEL_COLORS.length]
      })),
    [data]
  );

  if (!isManager) return chatterView;

  const exportByModel = () => {
    if (!data) return;
    void downloadApiFile("/manager/reports/analytics.xlsx", "analytics-por-modelo.xlsx", params);
  };

  const exportByChatter = () => {
    if (!data) return;
    void downloadApiFile("/manager/reports/analytics.xlsx", "analytics-por-chatter.xlsx", params);
  };

  return (
    <section className="stack-gap">
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p>Produção por modelo e por chatter</p>
        </div>
      </div>

      {/* Filtros */}
      <div className="card dashboard-filters">
        <div className="filter-top-row">
          <div className="segmented" role="group" aria-label="Período">
            {QUICK_WINDOWS.map((option) => (
              <button
                key={option.key}
                type="button"
                className={option.key === window ? "active" : ""}
                aria-pressed={option.key === window}
                onClick={() => {
                  setWindow(option.key);
                  setFromDate("");
                  setToDate("");
                }}
              >
                {option.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            className={`secondary-button ${activeFilters ? "filter-active-btn" : ""}`}
            onClick={() => setFiltersOpen((open) => !open)}
          >
            {filtersOpen ? "Ocultar filtros" : "Filtros"}
            {activeFilters ? <span className="filter-dot" /> : null}
          </button>
        </div>

        {filtersOpen ? (
          <div className="filter-grid">
            <label>
              De
              <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
            </label>
            <label>
              Até
              <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
            </label>
            <label>
              Modelo
              <select value={modelTagId} onChange={(event) => setModelTagId(event.target.value)}>
                <option value="">Todos</option>
                {tags.map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Chatter
              <select value={chatterId} onChange={(event) => setChatterId(event.target.value)}>
                <option value="">Todos</option>
                {chatters.map((chatter) => (
                  <option key={chatter.id} value={chatter.id}>
                    {chatter.displayName}
                  </option>
                ))}
              </select>
            </label>
            {activeFilters ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setFromDate("");
                  setToDate("");
                  setModelTagId("");
                  setChatterId("");
                  setWindow("month");
                }}
              >
                Limpar
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {loading ? (
        <div className="card skeleton-grid">
          <div className="skeleton" />
          <div className="skeleton" />
          <div className="skeleton" />
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      ) : null}

      {!loading && error ? <div className="error-box">{error}</div> : null}

      {!loading && !error && summary ? (
        <>
          {/* Toggle de métrica */}
          <div className="metric-toggle" role="group" aria-label="Métrica">
            {METRICS.map((option) => (
              <button
                key={option.key}
                type="button"
                className={option.key === metric ? "active" : ""}
                style={option.key === metric ? { borderColor: option.color, color: option.color } : undefined}
                aria-pressed={option.key === metric}
                onClick={() => setMetric(option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>

          {/* KPIs com sparkline */}
          <div className="kpi-grid">
            {kpiCards.map((card) => (
              <div className="kpi-card" key={card.label}>
                <div className="kpi-card-head">
                  <span>{card.label}</span>
                  <Sparkline values={dailyValues} stroke={card.color} />
                </div>
                <strong>{card.value}</strong>
              </div>
            ))}
          </div>

          {/* Tendência diária */}
          <div className="card chart-card">
            <div className="chart-card-head">
              <h2>Tendência diária</h2>
              <span className="chart-legend">
                <span className="legend-dot" style={{ background: metricConfig.color }} />
                {metricConfig.label}
              </span>
            </div>
            <AreaChart
              labels={dailyLabels}
              series={[{ name: metricConfig.label, values: dailyValues, color: metricConfig.color }]}
              formatValue={formatMetricValue}
            />
          </div>

          {/* Distribuição + ranking por modelo */}
          <div className="chart-row">
            <div className="card chart-card">
              <div className="chart-card-head">
                <h2>Payout por modelo</h2>
              </div>
              <Donut items={donutItems} formatValue={formatBrl} />
            </div>
            <div className="card chart-card">
              <div className="chart-card-head">
                <h2>Ranking por modelo</h2>
                <button className="secondary-button export-button" type="button" onClick={exportByModel}>
                  XLSX
                </button>
              </div>
              <BarList items={modelBarItems} formatValue={formatMetricValue} />
            </div>
          </div>

          {/* Ranking por chatter */}
          <div className="card chart-card">
            <div className="chart-card-head">
              <h2>Ranking por chatter</h2>
              <button className="secondary-button export-button" type="button" onClick={exportByChatter}>
                XLSX
              </button>
            </div>
            <BarList items={chatterBarItems} formatValue={formatMetricValue} maxItems={10} />
          </div>
        </>
      ) : null}
    </section>
  );
};

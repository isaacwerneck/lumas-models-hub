type AreaChartProps = {
  labels: string[];
  series: { name: string; values: number[]; color: string }[];
  height?: number;
  formatValue?: (value: number) => string;
};

const niceMax = (value: number) => {
  if (value <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const normalized = value / magnitude;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return nice * magnitude;
};

export const AreaChart = ({ labels, series, height = 220, formatValue = (value) => String(value) }: AreaChartProps) => {
  const width = 720;
  const padL = 52;
  const padR = 12;
  const padT = 16;
  const padB = 30;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const allValues = series.flatMap((s) => s.values);
  const max = niceMax(Math.max(...allValues, 1));
  const maxIndex = labels.length - 1;

  const x = (index: number) => padL + (maxIndex === 0 ? 0 : (index / maxIndex) * innerW);
  const y = (value: number) => padT + innerH - (value / max) * innerH;

  const gridLines = 4;
  const gridValues = Array.from({ length: gridLines + 1 }, (_, i) => (max / gridLines) * i);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="area-chart-svg" role="img" aria-label="Gráfico de tendência">
      {gridValues.map((value) => (
        <g key={value}>
          <line x1={padL} x2={width - padR} y1={y(value)} y2={y(value)} className="chart-grid-line" />
          <text x={padL - 8} y={y(value) + 4} textAnchor="end" className="chart-axis-label">
            {formatValue(value)}
          </text>
        </g>
      ))}

      {series.map((s) => {
        const points = s.values.map((value, index) => [x(index), y(value)] as const);
        if (points.length < 2) return null;
        const linePath = points.map(([px, py], index) => `${index === 0 ? "M" : "L"}${px.toFixed(1)},${py.toFixed(1)}`).join(" ");
        const areaPath = `${linePath} L${points[points.length - 1][0].toFixed(1)},${padT + innerH} L${points[0][0].toFixed(1)},${padT + innerH} Z`;
        return (
          <g key={s.name}>
            <path d={areaPath} fill={s.color} opacity={0.14} />
            <path d={linePath} fill="none" stroke={s.color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
          </g>
        );
      })}

      {labels.map((label, index) => (
        <text key={label} x={x(index)} y={height - 8} textAnchor="middle" className="chart-axis-label">
          {label}
        </text>
      ))}
    </svg>
  );
};
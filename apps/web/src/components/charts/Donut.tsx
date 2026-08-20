type DonutProps = {
  items: { label: string; value: number; color: string }[];
  size?: number;
  thickness?: number;
  formatValue?: (value: number) => string;
};

export const Donut = ({ items, size = 180, thickness = 26, formatValue = (value) => String(value) }: DonutProps) => {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  return (
    <div className="donut-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Distribuição">
        <circle cx={center} cy={center} r={radius} fill="none" stroke="var(--surface-border)" strokeWidth={thickness} />
        {items.map((item, index) => {
          const fraction = total > 0 ? item.value / total : 0;
          const dash = fraction * circumference;
          const offset = items.slice(0, index).reduce(
            (sum, previous) => sum + (total > 0 ? previous.value / total : 0) * circumference,
            0
          );
          return (
            <circle
              key={item.label}
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke={item.color}
              strokeWidth={thickness}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
              transform={`rotate(-90 ${center} ${center})`}
            />
          );
        })}
        <text x={center} y={center - 4} textAnchor="middle" className="donut-total">
          {formatValue(total)}
        </text>
        <text x={center} y={center + 16} textAnchor="middle" className="donut-caption">
          total
        </text>
      </svg>
      <ul className="donut-legend">
        {items.map((item) => (
          <li key={item.label}>
            <span className="donut-dot" style={{ background: item.color }} />
            <span className="donut-legend-label">{item.label}</span>
            <span className="donut-legend-value">{formatValue(item.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

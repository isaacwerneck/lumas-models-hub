type BarListProps = {
  items: { label: string; value: number; sub?: string; color?: string }[];
  formatValue?: (value: number) => string;
  maxItems?: number;
};

export const BarList = ({ items, formatValue = (value) => String(value), maxItems = 8 }: BarListProps) => {
  const top = items.slice(0, maxItems);
  const max = Math.max(...top.map((item) => item.value), 1);

  return (
    <div className="bar-list">
      {top.map((item, index) => (
        <div className="bar-row" key={`${item.label}-${index}`}>
          <div className="bar-row-head">
            <span className="bar-rank">{index + 1}</span>
            <span className="bar-label">{item.label}</span>
            {item.sub ? <span className="bar-sub">{item.sub}</span> : null}
            <span className="bar-value">{formatValue(item.value)}</span>
          </div>
          <div className="bar-track">
            <div
              className="bar-fill"
              style={{
                width: `${(item.value / max) * 100}%`,
                background: item.color ?? "var(--accent)"
              }}
            />
          </div>
        </div>
      ))}
      {top.length === 0 ? <p className="empty-hint">Sem dados no período.</p> : null}
    </div>
  );
};
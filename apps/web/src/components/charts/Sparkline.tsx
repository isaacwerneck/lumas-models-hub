type SparklineProps = {
  values: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
};

export const Sparkline = ({ values, width = 120, height = 36, stroke = "#7c5cff", fill = "rgba(124,92,255,0.18)" }: SparklineProps) => {
  if (values.length < 2) {
    return <svg width={width} height={height} aria-hidden="true" />;
  }

  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const pad = 3;

  const points = values.map((value, index) => {
    const x = pad + (index / (values.length - 1)) * (width - pad * 2);
    const y = height - pad - ((value - min) / range) * (height - pad * 2);
    return [x, y] as const;
  });

  const linePath = points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${points[points.length - 1][0].toFixed(1)},${height} L${points[0][0].toFixed(1)},${height} Z`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={areaPath} fill={fill} />
      <path d={linePath} fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={points[points.length - 1][0]} cy={points[points.length - 1][1]} r={2.5} fill={stroke} />
    </svg>
  );
};
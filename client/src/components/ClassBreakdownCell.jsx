export default function ClassBreakdownCell({
  label,
  value,
  color,
  flex = 1,
  borderRight = false,
  bold = false,
}) {
  return (
    <div
      style={{
        flex,
        padding: '9px 14px',
        background: color + '0d',
        borderRight: borderRight ? `1px solid ${color}25` : 'none',
      }}
    >
      <div style={{ fontSize: 10, color: '#777', marginBottom: 2, whiteSpace: 'nowrap' }}>
        {label}
      </div>
      <div style={{ fontSize: bold ? 14 : 13, fontWeight: bold ? 700 : 600, color }}>{value}</div>
    </div>
  );
}

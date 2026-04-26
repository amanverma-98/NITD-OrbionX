/**
 * RiskBadge Component
 * Color-coded status badge for risk levels
 */

export default function RiskBadge({ 
  level = 'LOW',
  count = null,
  animated = false,
  className = ''
}) {
  const riskConfig = {
    HIGH: {
      bg: 'bg-red-500/15',
      border: 'border-red-500/40',
      text: 'text-red-400',
      dot: 'bg-red-400',
      pulse: 'animate-blink-red'
    },
    MEDIUM: {
      bg: 'bg-yellow-500/15',
      border: 'border-yellow-500/40',
      text: 'text-yellow-400',
      dot: 'bg-yellow-400',
      pulse: ''
    },
    LOW: {
      bg: 'bg-green-500/15',
      border: 'border-green-500/40',
      text: 'text-green-400',
      dot: 'bg-green-400',
      pulse: ''
    }
  };

  const config = riskConfig[level] || riskConfig.LOW;

  return (
    <span 
      className={`
        badge ${config.bg} ${config.border} ${config.text}
        ${animated && config.pulse}
        ${className}
      `}
    >
      <span className={`inline-block h-2 w-2 rounded-full ${config.dot}`} />
      <span>{level}</span>
      {count !== null && <span className="ml-1 font-bold">({count})</span>}
    </span>
  );
}

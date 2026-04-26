/**
 * StatCard Component
 * Displays a metric with icon, gradient text, and optional trend indicator
 */

export default function StatCard({ 
  icon = null,
  label = '',
  value = '0',
  unit = '',
  color = 'cyan',
  trend = null,
  onClick = null,
  className = ''
}) {
  const colorClasses = {
    cyan: 'gradient-text from-cyan-400 to-cyan-600',
    purple: 'text-purple-400',
    green: 'text-green-400',
    red: 'text-red-400',
    yellow: 'text-yellow-400',
  };

  return (
    <div 
      onClick={onClick}
      className={`glass-panel rounded-lg p-4 card-hover-lift cursor-pointer group ${className}`}
    >
      <div className="flex items-start justify-between mb-3">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{label}</span>
        {trend && (
          <span className={`text-xs font-semibold ${trend.value >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {trend.value >= 0 ? '↑' : '↓'} {Math.abs(trend.value)}%
          </span>
        )}
      </div>
      
      {icon && <p className="text-xs text-slate-500 mb-2">{icon}</p>}
      
      <div className="flex items-baseline gap-1">
        <span className={`text-2xl font-bold ${colorClasses[color]}`}>
          {value}
        </span>
        {unit && <span className="text-xs text-slate-400">{unit}</span>}
      </div>
    </div>
  );
}

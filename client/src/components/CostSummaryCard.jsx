import React, { useState, useEffect } from 'react';
import { useAPI } from '../hooks/useAPI';
import { formatCurrency } from '../utils/formatters';

const TASK_LABELS = {
  competitor_analysis: '競合分析',
  tweet_generation: 'ツイート生成',
  comment_generation: 'コメント生成',
  quote_rt_generation: '引用RT生成',
  performance_summary: 'パフォーマンス要約',
  reply_generation: 'リプライ生成'
};

const PROVIDER_COLORS = {
  claude: { bar: 'bg-orange-400', text: 'text-orange-700', bg: 'bg-orange-50' },
  gemini: { bar: 'bg-blue-400', text: 'text-blue-700', bg: 'bg-blue-50' }
};

const TASK_COLORS = [
  'bg-blue-400', 'bg-emerald-400', 'bg-amber-400',
  'bg-rose-400', 'bg-purple-400', 'bg-cyan-400'
];

function BreakdownBar({ items, total }) {
  if (!items.length || total <= 0) return null;
  return (
    <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden flex">
      {items.map((item, i) => {
        const pct = (item.cost / total) * 100;
        if (pct < 0.5) return null;
        return (
          <div
            key={i}
            className={`h-2 ${item.color}`}
            style={{ width: `${pct}%` }}
            title={`${item.label}: ${formatCurrency(item.cost)}`}
          />
        );
      })}
    </div>
  );
}

function BreakdownRow({ label, cost, total, color }) {
  const pct = total > 0 ? ((cost / total) * 100).toFixed(1) : '0.0';
  return (
    <div className="flex items-center gap-2 text-xs">
      <div className={`w-2 h-2 rounded-full ${color} flex-shrink-0`} />
      <span className="text-gray-600 flex-1 truncate">{label}</span>
      <span className="text-gray-400 flex-shrink-0">{pct}%</span>
      <span className="text-gray-900 font-medium flex-shrink-0 w-14 text-right">{formatCurrency(cost)}</span>
    </div>
  );
}

export default function CostSummaryCard({ onDetailClick }) {
  const [data, setData] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const { get } = useAPI();

  useEffect(() => {
    get('/costs/summary').then(setData).catch(() => {});
  }, [get]);

  if (!data) return null;

  const alertColors = {
    none: 'border-gray-200',
    info: 'border-blue-300',
    warning: 'border-yellow-300',
    danger: 'border-red-300',
    critical: 'border-red-500'
  };

  const barColor = data.alertLevel === 'critical' || data.alertLevel === 'danger'
    ? 'bg-red-500'
    : data.alertLevel === 'warning'
      ? 'bg-yellow-500'
      : 'bg-blue-500';

  const providerItems = (data.byProvider || [])
    .map(p => ({
      label: p.provider === 'claude' ? 'Claude' : p.provider === 'gemini' ? 'Gemini' : p.provider,
      cost: p.cost,
      count: p.count,
      color: (PROVIDER_COLORS[p.provider] || { bar: 'bg-gray-400' }).bar
    }))
    .sort((a, b) => b.cost - a.cost);

  const taskItems = (data.byTask || [])
    .map((t, i) => ({
      label: TASK_LABELS[t.taskType] || t.taskType,
      cost: t.cost,
      count: t.count,
      color: TASK_COLORS[i % TASK_COLORS.length]
    }))
    .sort((a, b) => b.cost - a.cost);

  const modelItems = (data.byModel || [])
    .map(m => ({
      label: m.model,
      cost: m.cost,
      count: m.count,
      inputTokens: m.inputTokens,
      outputTokens: m.outputTokens
    }))
    .sort((a, b) => b.cost - a.cost);

  const toggleExpanded = (e) => {
    e.stopPropagation();
    setExpanded(!expanded);
  };

  return (
    <div className={`bg-white rounded-lg border-2 p-4 transition-shadow ${alertColors[data.alertLevel] || 'border-gray-200'}`}>
      {/* Header - clickable for detail modal */}
      <div
        className="cursor-pointer hover:opacity-80 transition-opacity"
        onClick={onDetailClick}
      >
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm text-gray-500">AI API利用額（今月）</p>
          {data.cacheSavingsUsd > 0 && (
            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
              Cache節約 {formatCurrency(data.cacheSavingsUsd)}
            </span>
          )}
        </div>

        <div className="flex items-baseline gap-2">
          <p className="text-2xl font-bold text-gray-900">{formatCurrency(data.totalCostUsd)}</p>
          <p className="text-sm text-gray-400">/ {formatCurrency(data.budgetUsd)}</p>
        </div>

        <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
          <div
            className={`h-2 rounded-full transition-all ${barColor}`}
            style={{ width: `${Math.min(data.budgetUsedPercent, 100)}%` }}
          />
        </div>

        <div className="flex justify-between mt-1">
          <p className="text-xs text-gray-400">{data.budgetUsedPercent.toFixed(1)}% 使用</p>
          <p className="text-xs text-gray-400">{data.totalRequests} リクエスト</p>
        </div>
      </div>

      {/* Expand/Collapse toggle */}
      <button
        onClick={toggleExpanded}
        className="w-full mt-3 pt-2 border-t border-gray-100 flex items-center justify-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
      >
        <span>{expanded ? '内訳を閉じる' : '内訳を表示'}</span>
        <svg
          className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expanded breakdown */}
      {expanded && (
        <div className="mt-3 space-y-4">
          {/* Provider breakdown */}
          {providerItems.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-2">プロバイダー別</p>
              <BreakdownBar items={providerItems} total={data.totalCostUsd} />
              <div className="mt-1.5 space-y-1">
                {providerItems.map((item, i) => (
                  <BreakdownRow
                    key={i}
                    label={`${item.label}（${item.count}回）`}
                    cost={item.cost}
                    total={data.totalCostUsd}
                    color={item.color}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Task breakdown */}
          {taskItems.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-2">タスク別</p>
              <BreakdownBar items={taskItems} total={data.totalCostUsd} />
              <div className="mt-1.5 space-y-1">
                {taskItems.map((item, i) => (
                  <BreakdownRow
                    key={i}
                    label={`${item.label}（${item.count}回）`}
                    cost={item.cost}
                    total={data.totalCostUsd}
                    color={item.color}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Model breakdown */}
          {modelItems.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-2">モデル別</p>
              <div className="space-y-1.5">
                {modelItems.map((item, i) => (
                  <div key={i} className="text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-600 font-mono text-[10px] truncate flex-1 mr-2">{item.label}</span>
                      <span className="text-gray-900 font-medium flex-shrink-0">{formatCurrency(item.cost)}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <div className="flex-1 h-1 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-1 bg-gray-300 rounded-full"
                          style={{ width: `${data.totalCostUsd > 0 ? (item.cost / data.totalCostUsd) * 100 : 0}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-gray-400 flex-shrink-0">
                        {item.count}回 / {(item.inputTokens + item.outputTokens).toLocaleString()}tok
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Link to full dashboard */}
          <button
            onClick={onDetailClick}
            className="w-full text-center text-xs text-blue-500 hover:text-blue-700 transition-colors pt-1"
          >
            詳細ダッシュボードを開く →
          </button>
        </div>
      )}
    </div>
  );
}

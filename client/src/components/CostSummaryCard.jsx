import React, { useState, useEffect } from 'react';
import { useAPI } from '../hooks/useAPI';
import { formatCurrency } from '../utils/formatters';

export default function CostSummaryCard({ onDetailClick }) {
  const [data, setData] = useState(null);
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

  return (
    <div
      className={`bg-white rounded-lg border-2 p-4 cursor-pointer hover:shadow-md transition-shadow ${alertColors[data.alertLevel] || 'border-gray-200'}`}
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

      {data.alertLevel !== 'none' && (
        <p className="text-xs text-gray-500 mt-2">
          クリックして詳細を表示
        </p>
      )}
    </div>
  );
}

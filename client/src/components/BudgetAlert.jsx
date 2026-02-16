import React, { useState, useEffect } from 'react';
import { useAPI } from '../hooks/useAPI';
import { formatCurrency } from '../utils/formatters';

export default function BudgetAlert() {
  const [budgetStatus, setBudgetStatus] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const { get } = useAPI();

  useEffect(() => {
    get('/costs/summary').then(data => {
      setBudgetStatus({
        alertLevel: data.alertLevel,
        usedPercent: data.budgetUsedPercent,
        totalCost: data.totalCostUsd,
        budget: data.budgetUsd,
        shouldPause: data.shouldPause
      });
    }).catch(() => {});
  }, [get]);

  if (!budgetStatus || budgetStatus.alertLevel === 'none' || dismissed) return null;

  const alertStyles = {
    info: {
      bg: 'bg-blue-50 border-blue-200',
      text: 'text-blue-800',
      icon: 'i',
      message: `月間予算の50%を超えました（${budgetStatus.usedPercent.toFixed(1)}% 使用）`
    },
    warning: {
      bg: 'bg-yellow-50 border-yellow-300',
      text: 'text-yellow-800',
      icon: '!',
      message: `月間予算の80%に到達しました（${formatCurrency(budgetStatus.totalCost)} / ${formatCurrency(budgetStatus.budget)}）`
    },
    danger: {
      bg: 'bg-red-50 border-red-300',
      text: 'text-red-800',
      icon: '!!',
      message: `月間予算の95%に到達。Batchモード優先に切り替えを推奨します。`
    },
    critical: {
      bg: 'bg-red-100 border-red-500',
      text: 'text-red-900',
      icon: 'X',
      message: `月間予算の100%に到達しました。AI API呼び出しが一時停止されています。設定画面から予算を増額してください。`
    }
  };

  const style = alertStyles[budgetStatus.alertLevel];
  if (!style) return null;

  return (
    <div className={`border rounded-lg p-3 flex items-center gap-3 ${style.bg}`}>
      <span className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${style.text} bg-white/50`}>
        {style.icon}
      </span>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${style.text}`}>{style.message}</p>
      </div>
      {budgetStatus.alertLevel !== 'critical' && (
        <button
          onClick={() => setDismissed(true)}
          className={`flex-shrink-0 text-sm ${style.text} opacity-60 hover:opacity-100`}
        >
          閉じる
        </button>
      )}
    </div>
  );
}

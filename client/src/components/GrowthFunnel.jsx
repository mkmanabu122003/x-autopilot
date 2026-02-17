import React from 'react';
import { formatNumber, formatPercent } from '../utils/formatters';

export default function GrowthFunnel({ data }) {
  if (!data) return null;

  const {
    thisMonthImpressions,
    thisMonthEngagements,
    followerGrowth30d
  } = data;

  const engagementRate = thisMonthImpressions > 0
    ? (thisMonthEngagements / thisMonthImpressions) * 100
    : 0;

  const followerRate = thisMonthEngagements > 0
    ? (followerGrowth30d / thisMonthEngagements) * 100
    : 0;

  const steps = [
    {
      label: 'インプレッション',
      value: thisMonthImpressions,
      color: 'bg-blue-500',
      lightColor: 'bg-blue-50',
      textColor: 'text-blue-700',
      width: '100%'
    },
    {
      label: 'エンゲージメント',
      value: thisMonthEngagements,
      rate: engagementRate,
      color: 'bg-amber-500',
      lightColor: 'bg-amber-50',
      textColor: 'text-amber-700',
      width: thisMonthImpressions > 0
        ? `${Math.max(20, (thisMonthEngagements / thisMonthImpressions) * 100 * 10)}%`
        : '60%'
    },
    {
      label: '新規フォロワー',
      value: followerGrowth30d,
      rate: followerRate,
      color: 'bg-emerald-500',
      lightColor: 'bg-emerald-50',
      textColor: 'text-emerald-700',
      width: thisMonthImpressions > 0
        ? `${Math.max(10, (followerGrowth30d / thisMonthImpressions) * 100 * 50)}%`
        : '30%'
    }
  ];

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h3 className="font-semibold text-gray-900 mb-4">成長ファネル（今月）</h3>
      <div className="space-y-3">
        {steps.map((step, i) => (
          <div key={step.label}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm text-gray-600">{step.label}</span>
              <div className="flex items-center gap-2">
                <span className={`text-sm font-bold ${step.textColor}`}>
                  {formatNumber(step.value)}
                </span>
                {step.rate !== undefined && (
                  <span className="text-xs text-gray-400">
                    ({formatPercent(step.rate)})
                  </span>
                )}
              </div>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-6 overflow-hidden">
              <div
                className={`h-full ${step.color} rounded-full transition-all duration-500 flex items-center justify-end pr-2`}
                style={{ width: step.width, minWidth: '2rem' }}
              >
              </div>
            </div>
            {i < steps.length - 1 && (
              <div className="flex justify-center my-1">
                <svg className="w-4 h-4 text-gray-300" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </div>
            )}
          </div>
        ))}
      </div>
      {thisMonthImpressions > 0 && followerGrowth30d > 0 && (
        <div className="mt-4 p-3 bg-emerald-50 rounded-lg">
          <p className="text-xs text-emerald-700">
            <span className="font-bold">{formatNumber(Math.round(thisMonthImpressions / Math.max(followerGrowth30d, 1)))} imp</span>
            あたり1フォロワー獲得
          </p>
        </div>
      )}
    </div>
  );
}

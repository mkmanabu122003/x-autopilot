import React, { useState, useEffect } from 'react';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useAPI } from '../hooks/useAPI';
import { useAccount } from '../contexts/AccountContext';
import { formatNumber } from '../utils/formatters';

export default function OwnWeeklyChart() {
  const [data, setData] = useState([]);
  const [weeks, setWeeks] = useState(12);
  const { get } = useAPI();
  const { currentAccount } = useAccount();

  useEffect(() => {
    const params = new URLSearchParams({ weeks: String(weeks) });
    if (currentAccount) params.set('accountId', currentAccount.id);
    get(`/growth/weekly-trend?${params}`).then(setData).catch(() => {});
  }, [get, currentAccount, weeks]);

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-900">自分の週間パフォーマンス</h3>
        <div className="flex gap-1">
          {[
            { label: '1M', value: 4 },
            { label: '3M', value: 12 },
            { label: '6M', value: 26 }
          ].map(opt => (
            <button
              key={opt.value}
              onClick={() => setWeeks(opt.value)}
              className={`px-2 py-1 text-xs rounded ${
                weeks === opt.value
                  ? 'bg-blue-100 text-blue-700'
                  : 'text-gray-500 hover:bg-gray-100'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <div className="h-64">
        {data.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-gray-400">
            投稿データが不足しています
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="week" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 12 }} tickFormatter={v => formatNumber(v)} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} unit="%" />
              <Tooltip
                formatter={(v, name) => {
                  if (name === 'エンゲージメント率') return `${Number(v).toFixed(2)}%`;
                  return formatNumber(v);
                }}
              />
              <Legend />
              <Bar
                yAxisId="left"
                dataKey="total_impressions"
                name="インプレッション"
                fill="#93c5fd"
                barSize={20}
                radius={[2, 2, 0, 0]}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="avg_engagement_rate"
                name="エンゲージメント率"
                stroke="#f59e0b"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

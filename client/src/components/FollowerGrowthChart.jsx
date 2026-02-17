import React, { useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useAPI } from '../hooks/useAPI';
import { useAccount } from '../contexts/AccountContext';
import { formatNumber } from '../utils/formatters';

export default function FollowerGrowthChart() {
  const [data, setData] = useState([]);
  const [days, setDays] = useState(90);
  const { get } = useAPI();
  const { currentAccount } = useAccount();

  useEffect(() => {
    const params = new URLSearchParams({ days: String(days) });
    if (currentAccount) params.set('accountId', currentAccount.id);
    get(`/growth/followers?${params}`).then(raw => {
      setData((raw || []).map(d => ({
        ...d,
        date: new Date(d.recorded_at).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })
      })));
    }).catch(() => {});
  }, [get, currentAccount, days]);

  const growth = data.length >= 2
    ? data[data.length - 1].follower_count - data[0].follower_count
    : 0;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-gray-900">フォロワー推移</h3>
          {data.length >= 2 && (
            <p className={`text-sm mt-1 ${growth >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {growth >= 0 ? '+' : ''}{formatNumber(growth)} ({days}日間)
            </p>
          )}
        </div>
        <div className="flex gap-1">
          {[
            { label: '30日', value: 30 },
            { label: '90日', value: 90 },
            { label: '180日', value: 180 }
          ].map(opt => (
            <button
              key={opt.value}
              onClick={() => setDays(opt.value)}
              className={`px-2 py-1 text-xs rounded ${
                days === opt.value
                  ? 'bg-emerald-100 text-emerald-700'
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
            フォロワーデータがまだありません。自動取得を待つか、手動で記録してください。
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <defs>
                <linearGradient id="followerGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis
                tick={{ fontSize: 12 }}
                domain={['dataMin - 10', 'dataMax + 10']}
                tickFormatter={v => formatNumber(v)}
              />
              <Tooltip
                formatter={(v) => [formatNumber(v), 'フォロワー']}
                labelFormatter={(label) => label}
              />
              <Area
                type="monotone"
                dataKey="follower_count"
                stroke="#10b981"
                strokeWidth={2}
                fill="url(#followerGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

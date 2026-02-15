import React, { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useAPI } from '../hooks/useAPI';

export default function HourlyChart() {
  const [data, setData] = useState([]);
  const { get } = useAPI();

  useEffect(() => {
    get('/analytics/hourly').then(setData).catch(() => {});
  }, [get]);

  // Determine top 3 hours for highlighting
  const sorted = [...data].sort((a, b) => b.avg_engagement_rate - a.avg_engagement_rate);
  const topHours = new Set(sorted.slice(0, 3).map(d => d.hour));

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h3 className="font-semibold text-gray-900 mb-4">時間帯別パフォーマンス</h3>
      <div className="h-64 overflow-x-auto">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="hour" tick={{ fontSize: 11 }} tickFormatter={(h) => `${h}時`} />
            <YAxis tick={{ fontSize: 12 }} unit="%" />
            <Tooltip
              formatter={(v) => `${Number(v).toFixed(2)}%`}
              labelFormatter={(h) => `${h}時`}
            />
            <Bar dataKey="avg_engagement_rate" name="エンゲージメント率">
              {data.map((entry) => (
                <Cell
                  key={entry.hour}
                  fill={topHours.has(entry.hour) ? '#f59e0b' : '#3b82f6'}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {sorted.length > 0 && (
        <p className="text-xs text-gray-500 mt-2">
          ゴールデンタイム: {sorted.slice(0, 3).map(d => `${d.hour}時`).join(', ')}
        </p>
      )}
    </div>
  );
}

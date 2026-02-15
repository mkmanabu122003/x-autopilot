import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useAPI } from '../hooks/useAPI';

export default function EngagementChart() {
  const [data, setData] = useState([]);
  const [weeks, setWeeks] = useState(12);
  const { get } = useAPI();

  useEffect(() => {
    get(`/analytics/weekly?weeks=${weeks}`).then(setData).catch(() => {});
  }, [get, weeks]);

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-900">週間エンゲージメント率推移</h3>
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
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="week" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} unit="%" />
            <Tooltip formatter={(v) => `${Number(v).toFixed(2)}%`} />
            <Legend />
            <Line
              type="monotone"
              dataKey="avg_engagement_rate"
              name="エンゲージメント率"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={{ r: 3 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

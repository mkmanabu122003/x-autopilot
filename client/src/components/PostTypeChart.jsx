import React, { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useAPI } from '../hooks/useAPI';

const TYPE_LABELS = {
  media: '画像/動画',
  link: 'リンク付き',
  thread: 'スレッド',
  text: 'テキストのみ'
};

export default function PostTypeChart() {
  const [data, setData] = useState([]);
  const { get } = useAPI();

  useEffect(() => {
    get('/analytics/post-types').then(d => {
      setData(d.map(item => ({
        ...item,
        label: TYPE_LABELS[item.post_type] || item.post_type
      })));
    }).catch(() => {});
  }, [get]);

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h3 className="font-semibold text-gray-900 mb-4">投稿タイプ別パフォーマンス</h3>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" unit="%" tick={{ fontSize: 12 }} />
            <YAxis type="category" dataKey="label" width={100} tick={{ fontSize: 12 }} />
            <Tooltip formatter={(v) => `${Number(v).toFixed(2)}%`} />
            <Bar dataKey="avg_engagement_rate" name="平均ER" fill="#8b5cf6" barSize={24} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

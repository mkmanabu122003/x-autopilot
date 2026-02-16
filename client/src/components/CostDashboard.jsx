import React, { useState, useEffect } from 'react';
import { useAPI } from '../hooks/useAPI';
import { formatCurrency } from '../utils/formatters';
import {
  ResponsiveContainer, PieChart, Pie, Cell,
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  LineChart, Line
} from 'recharts';

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

const TASK_LABELS = {
  competitor_analysis: '競合分析',
  tweet_generation: 'ツイート生成',
  comment_generation: 'コメント生成',
  quote_rt_generation: '引用RT生成',
  performance_summary: 'パフォーマンス要約'
};

export default function CostDashboard({ onClose }) {
  const [summary, setSummary] = useState(null);
  const [dailyCosts, setDailyCosts] = useState([]);
  const [optimizationScore, setOptimizationScore] = useState(null);
  const { get } = useAPI();

  useEffect(() => {
    get('/costs/summary').then(setSummary).catch(() => {});
    get('/costs/daily?days=30').then(setDailyCosts).catch(() => {});
    get('/costs/optimization-score').then(setOptimizationScore).catch(() => {});
  }, [get]);

  if (!summary) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-xl p-6 max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto">
          <p className="text-center text-gray-500">読み込み中...</p>
        </div>
      </div>
    );
  }

  const providerData = summary.byProvider.map(p => ({
    name: p.provider === 'claude' ? 'Claude' : p.provider === 'gemini' ? 'Gemini' : p.provider,
    value: p.cost
  }));

  const taskData = summary.byTask.map(t => ({
    name: TASK_LABELS[t.taskType] || t.taskType,
    cost: t.cost,
    count: t.count
  }));

  const gradeColors = {
    A: 'text-green-600 bg-green-100',
    B: 'text-blue-600 bg-blue-100',
    C: 'text-yellow-600 bg-yellow-100',
    D: 'text-orange-600 bg-orange-100',
    E: 'text-red-600 bg-red-100',
    F: 'text-red-800 bg-red-200'
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl p-6 max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-gray-900">コスト詳細ダッシュボード</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
        </div>

        {/* Summary row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-500">今月合計</p>
            <p className="text-lg font-bold">{formatCurrency(summary.totalCostUsd)}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-500">Cache節約額</p>
            <p className="text-lg font-bold text-green-600">{formatCurrency(summary.cacheSavingsUsd)}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-500">Cacheヒット率</p>
            <p className="text-lg font-bold">{summary.cacheHitRate.toFixed(1)}%</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-500">Batch利用率</p>
            <p className="text-lg font-bold">{summary.batchUsageRate.toFixed(1)}%</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Provider breakdown */}
          {providerData.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <h3 className="font-semibold text-gray-900 mb-3">プロバイダー別コスト</h3>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={providerData}
                    cx="50%" cy="50%"
                    innerRadius={50} outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                    label={({ name, value }) => `${name}: ${formatCurrency(value)}`}
                  >
                    {providerData.map((_, index) => (
                      <Cell key={index} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => formatCurrency(value)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Task breakdown */}
          {taskData.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <h3 className="font-semibold text-gray-900 mb-3">タスク別コスト</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={taskData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(value) => formatCurrency(value)} />
                  <Bar dataKey="cost" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Daily cost trend */}
        {dailyCosts.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-lg p-4 mt-6">
            <h3 className="font-semibold text-gray-900 mb-3">日別コスト推移（過去30日）</h3>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={dailyCosts}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={d => d.substring(5)} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(value) => formatCurrency(value)} />
                <Line type="monotone" dataKey="cost" stroke="#3B82F6" strokeWidth={2} dot={{ r: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Model usage table */}
        {summary.byModel.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-lg p-4 mt-6">
            <h3 className="font-semibold text-gray-900 mb-3">モデル別利用状況</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 px-2 text-gray-500 font-medium">モデル</th>
                    <th className="text-right py-2 px-2 text-gray-500 font-medium">リクエスト数</th>
                    <th className="text-right py-2 px-2 text-gray-500 font-medium">入力トークン</th>
                    <th className="text-right py-2 px-2 text-gray-500 font-medium">出力トークン</th>
                    <th className="text-right py-2 px-2 text-gray-500 font-medium">コスト</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.byModel.map((m, i) => (
                    <tr key={i} className="border-b border-gray-100">
                      <td className="py-2 px-2 font-mono text-xs">{m.model}</td>
                      <td className="py-2 px-2 text-right">{m.count}</td>
                      <td className="py-2 px-2 text-right">{m.inputTokens.toLocaleString()}</td>
                      <td className="py-2 px-2 text-right">{m.outputTokens.toLocaleString()}</td>
                      <td className="py-2 px-2 text-right font-medium">{formatCurrency(m.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Optimization score */}
        {optimizationScore && (
          <div className="bg-white border border-gray-200 rounded-lg p-4 mt-6">
            <h3 className="font-semibold text-gray-900 mb-3">コスト最適化スコア</h3>
            <div className="flex items-center gap-4 mb-4">
              <span className={`text-4xl font-bold px-4 py-2 rounded-lg ${gradeColors[optimizationScore.grade] || 'text-gray-600 bg-gray-100'}`}>
                {optimizationScore.grade}
              </span>
              <div>
                <p className="text-lg font-medium">{optimizationScore.totalScore.toFixed(0)} / 100</p>
                <p className="text-xs text-gray-500">総合スコア</p>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-gray-50 rounded p-2">
                <p className="text-xs text-gray-500">Cacheヒット率</p>
                <p className="font-medium">{optimizationScore.breakdown.cacheHitRate.value.toFixed(1)}%</p>
                <p className="text-xs text-gray-400">{optimizationScore.breakdown.cacheHitRate.score.toFixed(0)}/25点</p>
              </div>
              <div className="bg-gray-50 rounded p-2">
                <p className="text-xs text-gray-500">Batch利用率</p>
                <p className="font-medium">{optimizationScore.breakdown.batchUsageRate.value.toFixed(1)}%</p>
                <p className="text-xs text-gray-400">{optimizationScore.breakdown.batchUsageRate.score.toFixed(0)}/25点</p>
              </div>
              <div className="bg-gray-50 rounded p-2">
                <p className="text-xs text-gray-500">低コストモデル率</p>
                <p className="font-medium">{optimizationScore.breakdown.lowCostModelRate.value.toFixed(1)}%</p>
                <p className="text-xs text-gray-400">{optimizationScore.breakdown.lowCostModelRate.score.toFixed(0)}/25点</p>
              </div>
              <div className="bg-gray-50 rounded p-2">
                <p className="text-xs text-gray-500">コスト効率</p>
                <p className="font-medium">{formatCurrency(optimizationScore.breakdown.costEfficiency.avgCostPerRequest)}/req</p>
                <p className="text-xs text-gray-400">{optimizationScore.breakdown.costEfficiency.score}/25点</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

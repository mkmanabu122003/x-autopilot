import React from 'react';

const CLAUDE_MODELS = [
  { id: 'claude-opus-4-6', label: 'Opus 4.6（最高品質）' },
  { id: 'claude-sonnet-4-5-20250929', label: 'Sonnet 4.5（バランス型）' },
  { id: 'claude-sonnet-4-20250514', label: 'Sonnet 4（標準）' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5（高速・低コスト）' },
];

const GEMINI_MODELS = [
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro（高品質）' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash（バランス型）' },
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash（高速・最安）' },
  { id: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite（最安）' },
];

const EFFORT_OPTIONS = [
  { id: 'low', label: 'Low（高速）' },
  { id: 'medium', label: 'Medium（バランス）' },
  { id: 'high', label: 'High（高品質）' },
  { id: 'max', label: 'Max（最高品質）' },
];

const TASK_LABELS = {
  competitor_analysis: '競合分析',
  tweet_generation: 'ツイート生成',
  comment_generation: 'コメント生成',
  quote_rt_generation: '引用RT生成',
  performance_summary: 'パフォーマンス要約'
};

export default function ModelSelector({ taskModels, onChange }) {
  if (!taskModels || taskModels.length === 0) return null;

  const handleChange = (taskType, field, value) => {
    onChange(taskType, { ...getModel(taskType), [field]: value });
  };

  const getModel = (taskType) => {
    return taskModels.find(m => m.task_type === taskType) || {};
  };

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-2 px-1 text-xs font-medium text-gray-500">タスク</th>
              <th className="text-left py-2 px-1 text-xs font-medium text-gray-500">Claude モデル</th>
              <th className="text-left py-2 px-1 text-xs font-medium text-gray-500">Gemini モデル</th>
              <th className="text-left py-2 px-1 text-xs font-medium text-gray-500">Effort</th>
              <th className="text-left py-2 px-1 text-xs font-medium text-gray-500">Max Tokens</th>
            </tr>
          </thead>
          <tbody>
            {Object.keys(TASK_LABELS).map(taskType => {
              const model = getModel(taskType);
              return (
                <tr key={taskType} className="border-b border-gray-100">
                  <td className="py-2 px-1 text-xs font-medium text-gray-700">
                    {TASK_LABELS[taskType]}
                  </td>
                  <td className="py-2 px-1">
                    <select
                      value={model.claude_model || ''}
                      onChange={(e) => handleChange(taskType, 'claude_model', e.target.value)}
                      className="w-full px-1 py-1 border border-gray-300 rounded text-xs"
                    >
                      {CLAUDE_MODELS.map(m => (
                        <option key={m.id} value={m.id}>{m.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 px-1">
                    <select
                      value={model.gemini_model || ''}
                      onChange={(e) => handleChange(taskType, 'gemini_model', e.target.value)}
                      className="w-full px-1 py-1 border border-gray-300 rounded text-xs"
                    >
                      {GEMINI_MODELS.map(m => (
                        <option key={m.id} value={m.id}>{m.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 px-1">
                    <select
                      value={model.effort || 'medium'}
                      onChange={(e) => handleChange(taskType, 'effort', e.target.value)}
                      className="w-full px-1 py-1 border border-gray-300 rounded text-xs"
                    >
                      {EFFORT_OPTIONS.map(e => (
                        <option key={e.id} value={e.id}>{e.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 px-1">
                    <input
                      type="number"
                      value={model.max_tokens || 512}
                      onChange={(e) => handleChange(taskType, 'max_tokens', parseInt(e.target.value) || 512)}
                      min={128}
                      max={4096}
                      step={128}
                      className="w-20 px-1 py-1 border border-gray-300 rounded text-xs"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

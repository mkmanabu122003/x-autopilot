import React from 'react';

const CLAUDE_MODELS = [
  { id: 'claude-opus-4-6', label: 'Opus 4.6（最高品質）' },
  { id: 'claude-sonnet-4-5-20250929', label: 'Sonnet 4.5（バランス型）' },
  { id: 'claude-sonnet-4-20250514', label: 'Sonnet 4（標準）' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5（高速・低コスト）' },
];

const GEMINI_MODELS = [
  { id: 'gemini-2.5-pro', label: '2.5 Pro（高品質）' },
  { id: 'gemini-2.5-flash', label: '2.5 Flash（バランス型）' },
  { id: 'gemini-2.0-flash', label: '2.0 Flash（高速・最安）' },
  { id: 'gemini-2.0-flash-lite', label: '2.0 Flash Lite（最安）' },
];

const EFFORT_OPTIONS = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'max', label: 'Max' },
];

const TASK_LABELS = {
  competitor_analysis: '競合分析',
  tweet_generation: 'ツイート生成',
  comment_generation: 'コメント生成',
  quote_rt_generation: '引用RT生成',
  performance_summary: 'パフォーマンス要約'
};

const TASK_DEFAULTS = {
  competitor_analysis: { preferred_provider: 'claude', claude_model: 'claude-opus-4-6', gemini_model: 'gemini-2.5-pro', effort: 'high', max_tokens: 2048 },
  tweet_generation: { preferred_provider: 'claude', claude_model: 'claude-sonnet-4-5-20250929', gemini_model: 'gemini-2.5-flash', effort: 'medium', max_tokens: 512 },
  comment_generation: { preferred_provider: 'claude', claude_model: 'claude-haiku-4-5-20251001', gemini_model: 'gemini-2.0-flash', effort: 'low', max_tokens: 256 },
  quote_rt_generation: { preferred_provider: 'claude', claude_model: 'claude-haiku-4-5-20251001', gemini_model: 'gemini-2.0-flash', effort: 'low', max_tokens: 256 },
  performance_summary: { preferred_provider: 'claude', claude_model: 'claude-haiku-4-5-20251001', gemini_model: 'gemini-2.0-flash', effort: 'low', max_tokens: 1024 },
};

export default function ModelSelector({ taskModels, onChange }) {
  const handleChange = (taskType, field, value) => {
    onChange(taskType, { ...getModel(taskType), [field]: value });
  };

  const getModel = (taskType) => {
    const fromApi = (taskModels || []).find(m => m.task_type === taskType);
    const defaults = TASK_DEFAULTS[taskType] || {};
    return { ...defaults, ...fromApi };
  };

  return (
    <div className="space-y-3">
      {Object.keys(TASK_LABELS).map(taskType => {
        const model = getModel(taskType);
        const preferred = model.preferred_provider || 'claude';
        const isClaude = preferred === 'claude';

        return (
          <div key={taskType} className="border border-gray-200 rounded-lg p-3 space-y-2">
            {/* Task name + provider toggle */}
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">
                {TASK_LABELS[taskType]}
              </span>
              <div className="flex rounded-lg border border-gray-300 overflow-hidden">
                <button
                  type="button"
                  onClick={() => handleChange(taskType, 'preferred_provider', 'claude')}
                  className={`px-3 py-1 text-xs font-medium transition-colors ${
                    isClaude
                      ? 'bg-orange-500 text-white'
                      : 'bg-white text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  Claude
                </button>
                <button
                  type="button"
                  onClick={() => handleChange(taskType, 'preferred_provider', 'gemini')}
                  className={`px-3 py-1 text-xs font-medium transition-colors ${
                    !isClaude
                      ? 'bg-blue-500 text-white'
                      : 'bg-white text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  Gemini
                </button>
              </div>
            </div>

            {/* Model selection for the preferred provider */}
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[10px] text-gray-400 mb-0.5">
                  {isClaude ? 'Claude モデル' : 'Gemini モデル'}
                </label>
                <select
                  value={isClaude ? (model.claude_model || '') : (model.gemini_model || '')}
                  onChange={(e) => handleChange(taskType, isClaude ? 'claude_model' : 'gemini_model', e.target.value)}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs"
                >
                  {(isClaude ? CLAUDE_MODELS : GEMINI_MODELS).map(m => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-gray-400 mb-0.5">Effort</label>
                <select
                  value={model.effort || 'medium'}
                  onChange={(e) => handleChange(taskType, 'effort', e.target.value)}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs"
                >
                  {EFFORT_OPTIONS.map(e => (
                    <option key={e.id} value={e.id}>{e.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-gray-400 mb-0.5">Max Tokens</label>
                <input
                  type="number"
                  value={model.max_tokens || 512}
                  onChange={(e) => handleChange(taskType, 'max_tokens', parseInt(e.target.value) || 512)}
                  min={128}
                  max={4096}
                  step={128}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs"
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

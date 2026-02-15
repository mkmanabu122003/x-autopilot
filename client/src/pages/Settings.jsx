import React, { useState, useEffect } from 'react';
import { useSettings } from '../hooks/useSettings';
import { useAPI } from '../hooks/useAPI';
import { formatCurrency, formatPercent } from '../utils/formatters';
import ProviderSwitch from '../components/ProviderSwitch';

export default function Settings() {
  const { settings, updateSettings, loading } = useSettings();
  const { get } = useAPI();
  const [usage, setUsage] = useState(null);
  const [saved, setSaved] = useState(false);

  const [form, setForm] = useState({
    default_ai_provider: '',
    claude_model: '',
    gemini_model: '',
    competitor_fetch_interval: '',
    monthly_budget_usd: '',
    system_prompt: '',
    default_hashtags: '',
    confirm_before_post: '',
    competitor_max_accounts: ''
  });

  useEffect(() => {
    if (Object.keys(settings).length > 0) {
      setForm(prev => ({ ...prev, ...settings }));
    }
  }, [settings]);

  useEffect(() => {
    get('/settings/usage').then(setUsage).catch(() => {});
  }, [get]);

  const handleSave = async () => {
    try {
      await updateSettings(form);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      // ignore
    }
  };

  const handleChange = (key, value) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <h2 className="text-xl font-bold text-gray-900">設定</h2>

      {/* API Usage */}
      {usage && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="font-semibold text-gray-900 mb-3">API利用状況（今月）</h3>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">合計費用</span>
              <span className="font-medium">{formatCurrency(usage.totalCostUsd)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">予算消化率</span>
              <span className={`font-medium ${usage.budgetUsedPercent > 80 ? 'text-yellow-600' : 'text-gray-900'}`}>
                {formatPercent(usage.budgetUsedPercent)}
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className={`h-2 rounded-full ${usage.budgetUsedPercent > 80 ? 'bg-yellow-500' : 'bg-blue-500'}`}
                style={{ width: `${Math.min(usage.budgetUsedPercent, 100)}%` }}
              />
            </div>
            {usage.byType && usage.byType.length > 0 && (
              <div className="mt-2 space-y-1">
                {usage.byType.map(t => (
                  <div key={t.api_type} className="flex justify-between text-xs text-gray-500">
                    <span>{t.api_type}</span>
                    <span>{t.call_count}回 / {formatCurrency(t.total_cost)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* AI Settings */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
        <h3 className="font-semibold text-gray-900">AI設定</h3>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">デフォルトAIプロバイダー</label>
          <ProviderSwitch
            value={form.default_ai_provider}
            onChange={(v) => handleChange('default_ai_provider', v)}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Claude モデル</label>
          <input
            type="text"
            value={form.claude_model}
            onChange={(e) => handleChange('claude_model', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Gemini モデル</label>
          <input
            type="text"
            value={form.gemini_model}
            onChange={(e) => handleChange('gemini_model', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">システムプロンプト</label>
          <textarea
            value={form.system_prompt}
            onChange={(e) => handleChange('system_prompt', e.target.value)}
            rows={6}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none font-mono"
          />
          <p className="text-xs text-gray-400 mt-1">
            変数: {'{postType}'}, {'{userInput}'}, {'{competitorContext}'}
          </p>
        </div>
      </div>

      {/* Competitor Analysis Settings */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
        <h3 className="font-semibold text-gray-900">競合分析設定</h3>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">データ取得頻度</label>
          <select
            value={form.competitor_fetch_interval}
            onChange={(e) => handleChange('competitor_fetch_interval', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          >
            <option value="daily">毎日</option>
            <option value="weekly">週1回</option>
            <option value="biweekly">週2回</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">監視アカウント上限</label>
          <input
            type="number"
            value={form.competitor_max_accounts}
            onChange={(e) => handleChange('competitor_max_accounts', e.target.value)}
            min={1}
            max={50}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">月間予算 (USD)</label>
          <input
            type="number"
            value={form.monthly_budget_usd}
            onChange={(e) => handleChange('monthly_budget_usd', e.target.value)}
            min={1}
            step={1}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
        </div>
      </div>

      {/* Post Settings */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
        <h3 className="font-semibold text-gray-900">投稿設定</h3>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">デフォルトハッシュタグ</label>
          <input
            type="text"
            value={form.default_hashtags}
            onChange={(e) => handleChange('default_hashtags', e.target.value)}
            placeholder="#タグ1 #タグ2"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={form.confirm_before_post === 'true'}
            onChange={(e) => handleChange('confirm_before_post', e.target.checked ? 'true' : 'false')}
            className="rounded border-gray-300"
          />
          投稿前に確認ダイアログを表示
        </label>
      </div>

      {/* Save */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={loading}
          className="px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {loading ? '保存中...' : '設定を保存'}
        </button>
        {saved && <span className="text-sm text-green-600">保存しました</span>}
      </div>
    </div>
  );
}

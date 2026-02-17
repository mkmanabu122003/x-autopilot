import React, { useState, useEffect, useCallback } from 'react';
import { useSettings } from '../hooks/useSettings';
import { useAPI } from '../hooks/useAPI';
import { useAccount } from '../contexts/AccountContext';
import { formatCurrency, formatPercent } from '../utils/formatters';
import ModelSelect from '../components/ModelSelect';
import ModelSelector from '../components/ModelSelector';

const ACCOUNT_COLORS = ['#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4', '#F97316'];

const TABS = [
  { id: 'accounts', label: 'Xアカウント' },
  { id: 'cost', label: 'コスト最適化' },
  { id: 'ai', label: 'AI共通設定' },
  { id: 'competitor', label: '競合分析' },
  { id: 'post', label: '投稿設定' },
];

const TASK_TYPE_OPTIONS = [
  { value: 'tweet_generation', label: 'ツイート生成' },
  { value: 'comment_generation', label: 'コメント生成' },
  { value: 'quote_rt_generation', label: '引用RT生成' },
  { value: 'competitor_analysis', label: '競合分析' },
  { value: 'performance_summary', label: 'パフォーマンス要約' },
];

export default function Settings() {
  const { settings, updateSettings, loading } = useSettings();
  const { get, post, put, del } = useAPI();
  const { accounts, refreshAccounts, currentAccount } = useAccount();
  const [activeTab, setActiveTab] = useState('accounts');
  const [usage, setUsage] = useState(null);
  const [saved, setSaved] = useState(false);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null);
  const [accountError, setAccountError] = useState('');
  const [verifying, setVerifying] = useState(null);
  const [verifyResult, setVerifyResult] = useState(null);

  // Cost optimization state
  const [costSettings, setCostSettings] = useState(null);
  const [taskModels, setTaskModels] = useState([]);
  const [selectedPromptTask, setSelectedPromptTask] = useState('tweet_generation');
  const [promptData, setPromptData] = useState(null);
  const [costSaved, setCostSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const [form, setForm] = useState({
    competitor_fetch_interval: '',
    monthly_budget_usd: '',
    budget_x_api_usd: '',
    budget_gemini_usd: '',
    budget_claude_usd: '',
    system_prompt: '',
    default_hashtags: '',
    confirm_before_post: '',
    competitor_max_accounts: ''
  });

  const emptyAccountForm = {
    display_name: '',
    handle: '',
    color: ACCOUNT_COLORS[accounts.length % ACCOUNT_COLORS.length],
    api_key: '',
    api_secret: '',
    access_token: '',
    access_token_secret: '',
    bearer_token: '',
    default_ai_provider: 'claude',
    default_ai_model: 'claude-sonnet-4-20250514'
  };

  const [accountForm, setAccountForm] = useState(emptyAccountForm);

  useEffect(() => {
    if (Object.keys(settings).length > 0) {
      setForm(prev => ({ ...prev, ...settings }));
    }
  }, [settings]);

  const loadUsage = useCallback(() => {
    get('/settings/usage').then(setUsage).catch(() => {});
  }, [get]);

  useEffect(() => {
    loadUsage();
  }, [loadUsage]);

  // Load cost optimization settings
  const loadCostSettings = useCallback(() => {
    get('/settings/cost').then(setCostSettings).catch(() => {});
    get('/settings/task-models').then(setTaskModels).catch(() => {});
  }, [get]);

  useEffect(() => {
    loadCostSettings();
  }, [loadCostSettings]);

  // Load prompt for selected task
  useEffect(() => {
    get(`/settings/prompts/${selectedPromptTask}`).then(setPromptData).catch(() => {});
  }, [get, selectedPromptTask]);

  const handleSave = async () => {
    setSaving(true);
    setSaveError('');
    try {
      await updateSettings(form);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setSaveError(err.message || '設定の保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (key, value) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const handleAccountChange = (key, value) => {
    setAccountForm(prev => ({ ...prev, [key]: value }));
  };

  const handleAddAccount = async () => {
    setAccountError('');
    if (!accountForm.display_name || !accountForm.handle || !accountForm.api_key || !accountForm.api_secret || !accountForm.access_token || !accountForm.access_token_secret) {
      setAccountError('必須項目をすべて入力してください');
      return;
    }
    try {
      await post('/accounts', accountForm);
      await refreshAccounts();
      setAccountForm(emptyAccountForm);
      setShowAddAccount(false);
    } catch (err) {
      setAccountError(err.message);
    }
  };

  const handleEditAccount = async () => {
    setAccountError('');
    try {
      await put(`/accounts/${editingAccount.id}`, accountForm);
      await refreshAccounts();
      setEditingAccount(null);
    } catch (err) {
      setAccountError(err.message);
    }
  };

  const handleDeleteAccount = async (id) => {
    if (!window.confirm('このアカウントを削除しますか？関連する投稿データも削除されます。')) return;
    try {
      await del(`/accounts/${id}`);
      await refreshAccounts();
    } catch (err) {
      setAccountError(err.message);
    }
  };

  const handleVerifyAccount = async (accountId) => {
    setVerifying(accountId);
    setVerifyResult(null);
    try {
      const result = await post(`/accounts/${accountId}/verify`);
      setVerifyResult({ accountId, ...result });
    } catch (err) {
      setVerifyResult({ accountId, oauth: false, bearer: false, errors: [err.message] });
    } finally {
      setVerifying(null);
    }
  };

  const startEdit = async (account) => {
    try {
      const full = await get(`/accounts/${account.id}`);
      setAccountForm({
        display_name: full.display_name,
        handle: full.handle,
        color: full.color,
        api_key: full.api_key,
        api_secret: full.api_secret,
        access_token: full.access_token,
        access_token_secret: full.access_token_secret,
        bearer_token: full.bearer_token,
        default_ai_provider: full.default_ai_provider,
        default_ai_model: full.default_ai_model,
      });
      setEditingAccount(account);
      setShowAddAccount(false);
    } catch (err) {
      setAccountError(err.message);
    }
  };

  // Cost settings handlers
  const handleCostSettingChange = (key, value) => {
    setCostSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleSaveCostSettings = async () => {
    setSaving(true);
    setSaveError('');
    try {
      await put('/settings/cost', costSettings);
      // Also save per-API budgets to the settings KV table
      const budgetUpdates = {};
      for (const key of ['budget_x_api_usd', 'budget_gemini_usd', 'budget_claude_usd']) {
        if (form[key] !== undefined && form[key] !== '') {
          budgetUpdates[key] = form[key];
        }
      }
      if (Object.keys(budgetUpdates).length > 0) {
        await updateSettings(budgetUpdates);
      }
      setCostSaved(true);
      setTimeout(() => setCostSaved(false), 2000);
      // Refresh usage display so updated budgets are reflected
      loadUsage();
    } catch (err) {
      setSaveError(err.message || 'コスト設定の保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleTaskModelChange = async (taskType, updates) => {
    try {
      await put(`/settings/task-models/${taskType}`, updates);
      loadCostSettings();
    } catch (err) {
      // ignore
    }
  };

  const handleSavePrompt = async () => {
    if (!promptData) return;
    setSaving(true);
    setSaveError('');
    try {
      await put(`/settings/prompts/${selectedPromptTask}`, {
        system_prompt: promptData.system_prompt,
        user_template: promptData.user_template
      });
      setCostSaved(true);
      setTimeout(() => setCostSaved(false), 2000);
    } catch (err) {
      setSaveError(err.message || 'プロンプトの保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleResetPrompt = async () => {
    try {
      const result = await post(`/settings/prompts/${selectedPromptTask}/reset`);
      setPromptData({
        task_type: selectedPromptTask,
        system_prompt: result.system_prompt,
        user_template: result.user_template,
        is_custom: false
      });
    } catch (err) {
      // ignore
    }
  };

  const renderAccountForm = (isEdit) => (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">表示名 *</label>
          <input type="text" value={accountForm.display_name} onChange={(e) => handleAccountChange('display_name', e.target.value)}
            placeholder="メインアカウント" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">ハンドル *</label>
          <input type="text" value={accountForm.handle} onChange={(e) => handleAccountChange('handle', e.target.value)}
            placeholder="@username" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">カラー</label>
        <div className="flex gap-2">
          {ACCOUNT_COLORS.map(c => (
            <button key={c} type="button" onClick={() => handleAccountChange('color', c)}
              className={`w-7 h-7 rounded-full border-2 transition-all ${accountForm.color === c ? 'border-gray-900 scale-110' : 'border-transparent'}`}
              style={{ backgroundColor: c }} />
          ))}
        </div>
      </div>
      <div className="border-t border-gray-200 pt-3">
        <p className="text-xs font-medium text-gray-500 mb-2">X API クレデンシャル</p>
        <div className="space-y-2">
          <input type="text" value={accountForm.api_key} onChange={(e) => handleAccountChange('api_key', e.target.value)}
            placeholder="API Key *" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs font-mono" />
          <input type="text" value={accountForm.api_secret} onChange={(e) => handleAccountChange('api_secret', e.target.value)}
            placeholder="API Secret *" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs font-mono" />
          <input type="text" value={accountForm.access_token} onChange={(e) => handleAccountChange('access_token', e.target.value)}
            placeholder="Access Token *" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs font-mono" />
          <input type="text" value={accountForm.access_token_secret} onChange={(e) => handleAccountChange('access_token_secret', e.target.value)}
            placeholder="Access Token Secret *" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs font-mono" />
          <input type="text" value={accountForm.bearer_token} onChange={(e) => handleAccountChange('bearer_token', e.target.value)}
            placeholder="Bearer Token (任意)" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs font-mono" />
        </div>
      </div>
      <div className="border-t border-gray-200 pt-3">
        <p className="text-xs font-medium text-gray-500 mb-2">デフォルトAI設定</p>
        <ModelSelect
          provider={accountForm.default_ai_provider}
          model={accountForm.default_ai_model}
          onProviderChange={(v) => handleAccountChange('default_ai_provider', v)}
          onModelChange={(v) => handleAccountChange('default_ai_model', v)}
        />
      </div>
      {accountError && <p className="text-sm text-red-500">{accountError}</p>}
      <div className="flex gap-2">
        <button onClick={isEdit ? handleEditAccount : handleAddAccount}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">
          {isEdit ? '更新' : '追加'}
        </button>
        <button onClick={() => { isEdit ? setEditingAccount(null) : setShowAddAccount(false); setAccountError(''); }}
          className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
          キャンセル
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-6 max-w-3xl">
      <h2 className="text-xl font-bold text-gray-900">設定</h2>

      {/* Tab navigation */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
              activeTab === tab.id
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ===== Accounts Tab ===== */}
      {activeTab === 'accounts' && (
        <>
          <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">Xアカウント管理</h3>
              {!showAddAccount && !editingAccount && (
                <button
                  onClick={() => { setAccountForm({ ...emptyAccountForm, color: ACCOUNT_COLORS[accounts.length % ACCOUNT_COLORS.length] }); setShowAddAccount(true); setAccountError(''); }}
                  className="px-3 py-1 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  + アカウント追加
                </button>
              )}
            </div>

            {accounts.length === 0 && !showAddAccount && (
              <p className="text-sm text-gray-400 text-center py-4">
                Xアカウントが登録されていません
              </p>
            )}
            {accounts.map(account => (
              <div key={account.id} className="space-y-2">
                <div
                  className={`flex items-center gap-3 p-3 rounded-lg border-2 ${editingAccount?.id === account.id ? 'border-blue-400' : 'border-gray-100'}`}
                >
                  <span className="w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: account.color }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900">{account.display_name}</p>
                    <p className="text-xs text-gray-500">@{account.handle}</p>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <button onClick={() => handleVerifyAccount(account.id)} disabled={verifying === account.id}
                      className="px-2 py-1 text-xs text-green-600 border border-green-200 rounded hover:bg-green-50 transition-colors disabled:opacity-50">
                      {verifying === account.id ? '検証中...' : '検証'}
                    </button>
                    <button onClick={() => startEdit(account)}
                      className="px-2 py-1 text-xs text-blue-600 border border-blue-200 rounded hover:bg-blue-50 transition-colors">
                      編集
                    </button>
                    <button onClick={() => handleDeleteAccount(account.id)}
                      className="px-2 py-1 text-xs text-red-600 border border-red-200 rounded hover:bg-red-50 transition-colors">
                      削除
                    </button>
                  </div>
                </div>
                {verifyResult?.accountId === account.id && (
                  <div className={`ml-7 p-3 rounded-lg text-xs ${verifyResult.oauth ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className={verifyResult.oauth ? 'text-green-600' : 'text-red-600'}>
                          {verifyResult.oauth ? 'OK' : 'NG'} OAuth認証
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={verifyResult.bearer ? 'text-green-600' : 'text-gray-400'}>
                          {verifyResult.bearer ? 'OK' : 'NG'} Bearerトークン
                        </span>
                      </div>
                      {verifyResult.user && (
                        <p className="text-gray-700 mt-1">
                          認証ユーザー: {verifyResult.user.name} (@{verifyResult.user.username})
                        </p>
                      )}
                      {verifyResult.errors?.length > 0 && (
                        <div className="mt-1 text-red-600">
                          {verifyResult.errors.map((e, i) => <p key={i}>{e}</p>)}
                        </div>
                      )}
                    </div>
                    <button onClick={() => setVerifyResult(null)} className="mt-2 text-gray-500 hover:text-gray-700">
                      閉じる
                    </button>
                  </div>
                )}
              </div>
            ))}

            {editingAccount && renderAccountForm(true)}
            {showAddAccount && renderAccountForm(false)}
          </div>
        </>
      )}

      {/* ===== Cost Optimization Tab ===== */}
      {activeTab === 'cost' && costSettings && (
        <>
          {/* Monthly Budget */}
          <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
            <h3 className="font-semibold text-gray-900">月間予算</h3>
            <div className="flex items-center gap-3">
              <input
                type="number"
                value={costSettings.monthly_budget_usd || 33}
                onChange={(e) => handleCostSettingChange('monthly_budget_usd', parseFloat(e.target.value) || 0)}
                min={1} step={1}
                className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
              <span className="text-sm text-gray-500">USD（約 {Math.round((costSettings.monthly_budget_usd || 33) * 150).toLocaleString()}円）</span>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 mb-2">API別予算</p>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs text-sky-700 mb-1">X Developer API</label>
                  <input type="number" value={form.budget_x_api_usd}
                    onChange={(e) => handleChange('budget_x_api_usd', e.target.value)}
                    min={0} step={1} placeholder="10" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-emerald-700 mb-1">Gemini API</label>
                  <input type="number" value={form.budget_gemini_usd}
                    onChange={(e) => handleChange('budget_gemini_usd', e.target.value)}
                    min={0} step={1} placeholder="10" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-orange-700 mb-1">Claude API</label>
                  <input type="number" value={form.budget_claude_usd}
                    onChange={(e) => handleChange('budget_claude_usd', e.target.value)}
                    min={0} step={1} placeholder="13" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
              </div>
            </div>
          </div>

          {/* Task Model Settings */}
          <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
            <h3 className="font-semibold text-gray-900">タスク別モデル設定</h3>
            <p className="text-xs text-gray-500">各タスクのデフォルトAIモデル、effortレベル、最大トークン数を設定できます。</p>
            <ModelSelector taskModels={taskModels} onChange={handleTaskModelChange} />
          </div>

          {/* Prompt Caching */}
          <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
            <h3 className="font-semibold text-gray-900">Prompt Caching</h3>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={costSettings.cache_enabled || false}
                onChange={(e) => handleCostSettingChange('cache_enabled', e.target.checked)}
                className="rounded border-gray-300"
              />
              <span className="text-sm text-gray-700">システムプロンプトのキャッシュを有効にする</span>
            </label>
            <p className="text-xs text-gray-400">Claude APIのPrompt Cachingにより、入力トークンコストを最大90%削減できます。</p>
          </div>

          {/* Batch API */}
          <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
            <h3 className="font-semibold text-gray-900">Batch API</h3>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={costSettings.batch_enabled || false}
                onChange={(e) => handleCostSettingChange('batch_enabled', e.target.checked)}
                className="rounded border-gray-300"
              />
              <span className="text-sm text-gray-700">一括生成でBatch APIを使用する（50%コスト削減）</span>
            </label>
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-700">バッチ実行時刻:</label>
              <select
                value={costSettings.batch_schedule_hour || 3}
                onChange={(e) => handleCostSettingChange('batch_schedule_hour', parseInt(e.target.value))}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
                ))}
              </select>
            </div>
          </div>

          {/* Budget Alerts */}
          <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
            <h3 className="font-semibold text-gray-900">予算アラート</h3>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={costSettings.budget_alert_80 || false}
                onChange={(e) => handleCostSettingChange('budget_alert_80', e.target.checked)}
                className="rounded border-gray-300"
              />
              <span className="text-sm text-gray-700">80%到達で警告通知</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={costSettings.budget_pause_100 || false}
                onChange={(e) => handleCostSettingChange('budget_pause_100', e.target.checked)}
                className="rounded border-gray-300"
              />
              <span className="text-sm text-gray-700">100%到達でAPI呼び出し一時停止</span>
            </label>
          </div>

          {/* Prompt Templates */}
          <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
            <h3 className="font-semibold text-gray-900">プロンプトテンプレート</h3>
            <select
              value={selectedPromptTask}
              onChange={(e) => setSelectedPromptTask(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              {TASK_TYPE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            {promptData && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    システムプロンプト
                    {promptData.is_custom && <span className="ml-1 text-blue-500">（カスタム）</span>}
                  </label>
                  <textarea
                    value={promptData.system_prompt || ''}
                    onChange={(e) => setPromptData(prev => ({ ...prev, system_prompt: e.target.value }))}
                    rows={10}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-y font-mono min-h-[120px]"
                  />
                </div>
                <div className="flex gap-2">
                  <button onClick={handleSavePrompt}
                    className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">
                    保存
                  </button>
                  <button onClick={handleResetPrompt}
                    className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
                    デフォルトに戻す
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Save cost settings */}
          <div className="flex items-center gap-3">
            <button onClick={handleSaveCostSettings} disabled={saving}
              className="px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {saving ? '保存中...' : 'コスト設定を保存'}
            </button>
            {costSaved && <span className="text-sm text-green-600">保存しました</span>}
            {saveError && <span className="text-sm text-red-500">{saveError}</span>}
          </div>
        </>
      )}

      {/* ===== AI Common Settings Tab ===== */}
      {activeTab === 'ai' && (
        <>
          {usage && (
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <h3 className="font-semibold text-gray-900 mb-3">API利用状況（今月）</h3>

              <div className="flex justify-between text-sm mb-4 pb-3 border-b border-gray-100">
                <span className="text-gray-600">合計費用</span>
                <span className="font-bold text-gray-900">{formatCurrency(usage.totalCostUsd)}</span>
              </div>

              <div className="space-y-4">
                {(usage.apis || []).map(api => {
                  const labels = { x: 'X Developer API', gemini: 'Gemini API', claude: 'Claude API' };
                  const colors = { x: 'bg-sky-500', gemini: 'bg-emerald-500', claude: 'bg-orange-500' };
                  const textColors = { x: 'text-sky-700', gemini: 'text-emerald-700', claude: 'text-orange-700' };
                  const bgColors = { x: 'bg-sky-50', gemini: 'bg-emerald-50', claude: 'bg-orange-50' };
                  return (
                    <div key={api.category} className={`rounded-lg p-3 ${bgColors[api.category] || 'bg-gray-50'}`}>
                      <div className="flex justify-between items-center mb-1">
                        <span className={`text-sm font-medium ${textColors[api.category] || 'text-gray-700'}`}>
                          {labels[api.category] || api.category}
                        </span>
                        <span className="text-xs text-gray-500">{api.call_count}回</span>
                      </div>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-600">{formatCurrency(api.total_cost)} / {formatCurrency(api.budget_usd)}</span>
                        <span className={`font-medium ${api.budget_used_percent > 80 ? 'text-red-600' : 'text-gray-700'}`}>
                          {formatPercent(api.budget_used_percent)}
                        </span>
                      </div>
                      <div className="w-full bg-white/60 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full transition-all ${api.budget_used_percent > 80 ? 'bg-red-500' : (colors[api.category] || 'bg-blue-500')}`}
                          style={{ width: `${Math.min(api.budget_used_percent, 100)}%` }}
                        />
                      </div>
                      {/* Breakdown details */}
                      {api.breakdown && api.breakdown.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-white/40 space-y-1">
                          <p className="text-xs font-medium text-gray-500 mb-1">内訳</p>
                          {api.breakdown.map(item => (
                            <div key={item.key} className="flex justify-between items-center text-xs">
                              <span className="text-gray-600 truncate mr-2">{item.label}</span>
                              <span className="text-gray-500 whitespace-nowrap">
                                {formatCurrency(item.total_cost)} ({item.call_count}回)
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
            <h3 className="font-semibold text-gray-900">AI共通設定</h3>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">システムプロンプト</label>
              <textarea
                value={form.system_prompt}
                onChange={(e) => handleChange('system_prompt', e.target.value)}
                rows={12}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-y font-mono min-h-[120px]"
              />
              <p className="text-xs text-gray-400 mt-1">
                変数: {'{postType}'}, {'{userInput}'}, {'{competitorContext}'} &#x2502; ドラッグでサイズ変更可能
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button onClick={handleSave} disabled={saving}
              className="px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {saving ? '保存中...' : '設定を保存'}
            </button>
            {saved && <span className="text-sm text-green-600">保存しました</span>}
            {saveError && <span className="text-sm text-red-500">{saveError}</span>}
          </div>
        </>
      )}

      {/* ===== Competitor Analysis Tab ===== */}
      {activeTab === 'competitor' && (
        <>
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
              <input type="number" value={form.competitor_max_accounts}
                onChange={(e) => handleChange('competitor_max_accounts', e.target.value)}
                min={1} max={50} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">月間予算 (USD)</label>
              <input type="number" value={form.monthly_budget_usd}
                onChange={(e) => handleChange('monthly_budget_usd', e.target.value)}
                min={1} step={1} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button onClick={handleSave} disabled={saving}
              className="px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {saving ? '保存中...' : '設定を保存'}
            </button>
            {saved && <span className="text-sm text-green-600">保存しました</span>}
            {saveError && <span className="text-sm text-red-500">{saveError}</span>}
          </div>
        </>
      )}

      {/* ===== Post Settings Tab ===== */}
      {activeTab === 'post' && (
        <>
          <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
            <h3 className="font-semibold text-gray-900">投稿設定</h3>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">デフォルトハッシュタグ</label>
              <input type="text" value={form.default_hashtags}
                onChange={(e) => handleChange('default_hashtags', e.target.value)}
                placeholder="#タグ1 #タグ2" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button onClick={handleSave} disabled={saving}
              className="px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {saving ? '保存中...' : '設定を保存'}
            </button>
            {saved && <span className="text-sm text-green-600">保存しました</span>}
            {saveError && <span className="text-sm text-red-500">{saveError}</span>}
          </div>
        </>
      )}
    </div>
  );
}

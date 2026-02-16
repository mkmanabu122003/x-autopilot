import React, { useState, useEffect } from 'react';
import { useSettings } from '../hooks/useSettings';
import { useAPI } from '../hooks/useAPI';
import { useAccount } from '../contexts/AccountContext';
import { formatCurrency, formatPercent } from '../utils/formatters';
import ModelSelect from '../components/ModelSelect';

const ACCOUNT_COLORS = ['#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4', '#F97316'];

export default function Settings() {
  const { settings, updateSettings, loading } = useSettings();
  const { get, post, put, del } = useAPI();
  const { accounts, refreshAccounts, currentAccount } = useAccount();
  const [usage, setUsage] = useState(null);
  const [saved, setSaved] = useState(false);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null);
  const [accountError, setAccountError] = useState('');
  const [verifying, setVerifying] = useState(null);
  const [verifyResult, setVerifyResult] = useState(null);

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
    <div className="space-y-6 max-w-2xl">
      <h2 className="text-xl font-bold text-gray-900">設定</h2>

      {/* Account Management */}
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

        {/* Account list */}
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

        {/* Edit form */}
        {editingAccount && renderAccountForm(true)}

        {/* Add form */}
        {showAddAccount && renderAccountForm(false)}
      </div>

      {/* API Usage */}
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
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* General AI Settings (system prompt) */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
        <h3 className="font-semibold text-gray-900">AI共通設定</h3>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">システムプロンプト</label>
          <textarea
            value={form.system_prompt}
            onChange={(e) => handleChange('system_prompt', e.target.value)}
            rows={10}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-y font-mono leading-relaxed"
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
          <input type="number" value={form.competitor_max_accounts}
            onChange={(e) => handleChange('competitor_max_accounts', e.target.value)}
            min={1} max={50} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">月間予算 (USD)</label>
          <div className="space-y-2">
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
            <div>
              <label className="block text-xs text-gray-500 mb-1">合計予算</label>
              <input type="number" value={form.monthly_budget_usd}
                onChange={(e) => handleChange('monthly_budget_usd', e.target.value)}
                min={1} step={1} placeholder="33" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
          </div>
        </div>
      </div>

      {/* Post Settings */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
        <h3 className="font-semibold text-gray-900">投稿設定</h3>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">デフォルトハッシュタグ</label>
          <input type="text" value={form.default_hashtags}
            onChange={(e) => handleChange('default_hashtags', e.target.value)}
            placeholder="#タグ1 #タグ2" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
      </div>

      {/* Save */}
      <div className="flex items-center gap-3">
        <button onClick={handleSave} disabled={loading}
          className="px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
          {loading ? '保存中...' : '設定を保存'}
        </button>
        {saved && <span className="text-sm text-green-600">保存しました</span>}
      </div>
    </div>
  );
}

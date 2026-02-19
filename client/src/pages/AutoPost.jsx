import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAPI } from '../hooks/useAPI';
import { useAccount } from '../contexts/AccountContext';

const AI_MODELS = [
  { id: '', label: 'デフォルト（タスク設定に従う）' },
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { id: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5' },
  { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
];

const POST_TYPE_CONFIG = {
  new: {
    label: '新規ツイート',
    description: 'AIがテーマに基づいて新しいツイートを自動生成します',
    color: 'blue',
    hasThemes: true,
  },
  reply: {
    label: 'リプライ',
    description: '競合の高エンゲージメントツイートに自動でリプライします',
    color: 'green',
    hasThemes: false,
  },
  quote: {
    label: '引用リツイート',
    description: '競合の高エンゲージメントツイートを自動で引用RTします',
    color: 'purple',
    hasThemes: false,
  },
};

const STATUS_LABELS = {
  success: { text: '成功', className: 'bg-green-100 text-green-700' },
  partial: { text: '一部成功', className: 'bg-yellow-100 text-yellow-700' },
  failed: { text: '失敗', className: 'bg-red-100 text-red-700' },
};

const COLOR_MAP = {
  blue: {
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    header: 'bg-blue-100 text-blue-800',
    toggle: 'bg-blue-600',
    badge: 'bg-blue-100 text-blue-700',
  },
  green: {
    bg: 'bg-green-50',
    border: 'border-green-200',
    header: 'bg-green-100 text-green-800',
    toggle: 'bg-green-600',
    badge: 'bg-green-100 text-green-700',
  },
  purple: {
    bg: 'bg-purple-50',
    border: 'border-purple-200',
    header: 'bg-purple-100 text-purple-800',
    toggle: 'bg-purple-600',
    badge: 'bg-purple-100 text-purple-700',
  },
};

export default function AutoPost() {
  const { get, put, post, loading } = useAPI();
  const { currentAccount } = useAccount();
  const navigate = useNavigate();
  const [settings, setSettings] = useState({});
  const [logs, setLogs] = useState([]);
  const [logTotal, setLogTotal] = useState(0);
  const [logPage, setLogPage] = useState(0);
  const LOG_PER_PAGE = 20;
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [running, setRunning] = useState(null);
  const [activeTab, setActiveTab] = useState('settings');
  const [draftResult, setDraftResult] = useState(null);
  const [themeCategories, setThemeCategories] = useState([]);
  const [categorySaving, setCategorySaving] = useState(false);
  const [categorySaved, setCategorySaved] = useState(false);

  const loadSettings = useCallback(async () => {
    if (!currentAccount) return;
    try {
      const data = await get(`/auto-post/settings?accountId=${currentAccount.id}`);
      const map = {};
      for (const s of data) {
        map[s.post_type] = {
          id: s.id,
          enabled: s.enabled,
          postsPerDay: s.posts_per_day,
          scheduleTimes: s.schedule_times,
          scheduleMode: s.schedule_mode,
          themes: s.themes,
          tone: s.tone || '',
          targetAudience: s.target_audience || '',
          styleNote: s.style_note || '',
          aiModel: s.ai_model || '',
          maxLength: s.max_length || 0,
          lastRunDate: s.last_run_date,
          lastRunTimes: s.last_run_times,
        };
      }
      setSettings(map);
    } catch (e) {
      // Initialize defaults if no settings exist
      setSettings({});
    }
  }, [get, currentAccount]);

  const loadLogs = useCallback(async (page = 0) => {
    if (!currentAccount) return;
    try {
      const offset = page * LOG_PER_PAGE;
      const data = await get(`/auto-post/logs?accountId=${currentAccount.id}&limit=${LOG_PER_PAGE}&offset=${offset}`);
      setLogs(data.logs || []);
      setLogTotal(data.total || 0);
      setLogPage(page);
    } catch (e) {
      setLogs([]);
      setLogTotal(0);
    }
  }, [get, currentAccount]);

  const loadThemeCategories = useCallback(async () => {
    if (!currentAccount) return;
    try {
      const data = await get(`/auto-post/theme-categories?accountId=${currentAccount.id}`);
      setThemeCategories(data || []);
    } catch (e) {
      setThemeCategories([]);
    }
  }, [get, currentAccount]);

  useEffect(() => {
    loadSettings();
    loadLogs();
    loadThemeCategories();
  }, [loadSettings, loadLogs, loadThemeCategories]);

  const getDefault = (postType) => ({
    enabled: false,
    postsPerDay: postType === 'reply' ? 2 : 3,
    scheduleTimes: postType === 'new' ? '09:00' : postType === 'reply' ? '10:00,13:00' : '11:00',
    scheduleMode: postType === 'reply' ? 'immediate' : 'scheduled',
    themes: '',
    tone: '',
    targetAudience: '',
    styleNote: '',
    aiModel: '',
    maxLength: 0,
  });

  const getSetting = (postType) => settings[postType] || getDefault(postType);

  const updateSetting = (postType, key, value) => {
    setSettings(prev => ({
      ...prev,
      [postType]: {
        ...getDefault(postType),
        ...prev[postType],
        [key]: value,
      },
    }));
  };

  const handleToggle = async (postType) => {
    if (!currentAccount) return;
    const s = getSetting(postType);
    const newEnabled = !s.enabled;
    updateSetting(postType, 'enabled', newEnabled);
    try {
      await put('/auto-post/settings', {
        accountId: currentAccount.id,
        postType,
        enabled: newEnabled,
        postsPerDay: s.postsPerDay,
        scheduleTimes: s.scheduleTimes,
        scheduleMode: s.scheduleMode,
        themes: s.themes,
        tone: s.tone,
        targetAudience: s.targetAudience,
        styleNote: s.styleNote,
        aiModel: s.aiModel,
        maxLength: s.maxLength,
      });
      await loadSettings();
    } catch (e) {
      // Revert on failure
      updateSetting(postType, 'enabled', !newEnabled);
    }
  };

  const handleSave = async (postType) => {
    if (!currentAccount) return;
    const s = getSetting(postType);
    setSaving(postType);
    setSaveError(null);
    try {
      await put('/auto-post/settings', {
        accountId: currentAccount.id,
        postType,
        enabled: s.enabled,
        postsPerDay: s.postsPerDay,
        scheduleTimes: s.scheduleTimes,
        scheduleMode: s.scheduleMode,
        themes: s.themes,
        tone: s.tone,
        targetAudience: s.targetAudience,
        styleNote: s.styleNote,
        aiModel: s.aiModel,
        maxLength: s.maxLength,
      });
      setSaved(postType);
      setTimeout(() => setSaved(false), 2000);
      await loadSettings();
    } catch (e) {
      setSaveError({ postType, message: e.message || '保存に失敗しました' });
    } finally {
      setSaving(null);
    }
  };

  const handleManualRun = async (postType) => {
    if (!currentAccount) return;
    let s = getSetting(postType);
    if (!window.confirm(`${POST_TYPE_CONFIG[postType].label}のAI生成を実行し、下書きとして保存します。よろしいですか？`)) return;
    setRunning(postType);
    setDraftResult(null);
    try {
      // Auto-save settings if not yet saved
      if (!s.id) {
        const result = await put('/auto-post/settings', {
          accountId: currentAccount.id,
          postType,
          enabled: s.enabled,
          postsPerDay: s.postsPerDay,
          scheduleTimes: s.scheduleTimes,
          scheduleMode: s.scheduleMode,
          themes: s.themes,
          tone: s.tone,
          targetAudience: s.targetAudience,
          styleNote: s.styleNote,
        });
        await loadSettings();
        s = { ...s, id: result.id };
      }
      const result = await post(`/auto-post/run/${s.id}`);
      setDraftResult({ postType, drafts: result.drafts || 0 });
      await loadLogs();
    } catch (e) {
      alert(`実行エラー: ${e.message}`);
      await loadLogs();
      setActiveTab('logs');
    } finally {
      setRunning(null);
    }
  };

  // Theme category management
  const addCategory = () => {
    const nextIndex = themeCategories.length + 1;
    const code = `T-${String.fromCharCode(64 + nextIndex)}`;
    setThemeCategories([...themeCategories, { code, name: '', description: '', enabled: true }]);
  };

  const updateCategory = (index, field, value) => {
    setThemeCategories(prev => prev.map((cat, i) => i === index ? { ...cat, [field]: value } : cat));
  };

  const removeCategory = (index) => {
    setThemeCategories(prev => prev.filter((_, i) => i !== index));
  };

  const saveThemeCategories = async () => {
    if (!currentAccount) return;
    setCategorySaving(true);
    try {
      await put('/auto-post/theme-categories', {
        accountId: currentAccount.id,
        categories: themeCategories.filter(c => c.name.trim()),
      });
      setCategorySaved(true);
      setTimeout(() => setCategorySaved(false), 2000);
      await loadThemeCategories();
    } catch (e) {
      alert(`保存エラー: ${e.message}`);
    } finally {
      setCategorySaving(false);
    }
  };

  const formatTime = (isoString) => {
    if (!isoString) return '-';
    const d = new Date(isoString);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  if (!currentAccount) {
    return (
      <div className="text-center py-12 text-gray-400">
        アカウントを選択してください
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl relative">
      {/* Loading overlay during AI generation */}
      {running && (
        <div className="fixed inset-0 bg-white/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
            <p className="text-sm font-medium text-gray-700">
              {POST_TYPE_CONFIG[running]?.label || ''}のAI生成中...
            </p>
          </div>
        </div>
      )}

      <div>
        <h2 className="text-xl font-bold text-gray-900">自動投稿</h2>
        <p className="text-sm text-gray-500 mt-1">
          指定した時間にAIがコンテンツを生成し、自動で投稿・予約します
        </p>
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
        <button
          onClick={() => setActiveTab('settings')}
          className={`flex-1 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
            activeTab === 'settings' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          設定
        </button>
        <button
          onClick={() => { setActiveTab('logs'); loadLogs(); }}
          className={`flex-1 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
            activeTab === 'logs' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          実行ログ
        </button>
      </div>

      {activeTab === 'settings' && (
        <>
          {/* Summary card */}
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <h3 className="font-semibold text-gray-900 mb-3">現在の設定サマリー</h3>
            <div className="grid grid-cols-3 gap-3">
              {['new', 'reply', 'quote'].map(type => {
                const s = getSetting(type);
                const config = POST_TYPE_CONFIG[type];
                const colors = COLOR_MAP[config.color];
                return (
                  <div key={type} className={`rounded-lg p-3 ${colors.bg} border ${colors.border}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium">{config.label}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${s.enabled ? colors.badge : 'bg-gray-100 text-gray-500'}`}>
                        {s.enabled ? 'ON' : 'OFF'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600">
                      {s.postsPerDay}件/日 - {s.scheduleTimes}
                    </p>
                    <p className="text-xs text-gray-500">
                      {s.scheduleMode === 'scheduled' ? '予約投稿' : s.scheduleMode === 'draft' ? '下書き保存' : '即時投稿'}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Individual post type cards */}
          {['new', 'reply', 'quote'].map(postType => {
            const s = getSetting(postType);
            const config = POST_TYPE_CONFIG[postType];
            const colors = COLOR_MAP[config.color];

            return (
              <div key={postType} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                {/* Header */}
                <div className={`px-4 py-3 ${colors.header} flex items-center justify-between`}>
                  <div>
                    <h3 className="font-semibold">{config.label}</h3>
                    <p className="text-xs opacity-75 mt-0.5">{config.description}</p>
                  </div>
                  <button
                    onClick={() => handleToggle(postType)}
                    className={`relative w-12 h-6 rounded-full transition-colors ${s.enabled ? colors.toggle : 'bg-gray-300'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${s.enabled ? 'translate-x-6' : ''}`} />
                  </button>
                </div>

                {/* Settings body */}
                <div className="p-4 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    {/* Posts per day */}
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">1日の投稿数</label>
                      <input
                        type="number"
                        min={1}
                        max={10}
                        value={s.postsPerDay}
                        onChange={(e) => updateSetting(postType, 'postsPerDay', parseInt(e.target.value) || 1)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      />
                    </div>

                    {/* Schedule mode */}
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">投稿モード</label>
                      <select
                        value={s.scheduleMode}
                        onChange={(e) => updateSetting(postType, 'scheduleMode', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      >
                        <option value="scheduled">予約投稿（時間帯に分散）</option>
                        <option value="immediate">即時投稿</option>
                        <option value="draft">下書き保存（確認後に手動投稿）</option>
                      </select>
                    </div>
                  </div>

                  {/* Schedule times */}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      実行時刻（カンマ区切りで複数指定可: 09:00,13:00）
                    </label>
                    <input
                      type="text"
                      value={s.scheduleTimes}
                      onChange={(e) => updateSetting(postType, 'scheduleTimes', e.target.value)}
                      placeholder="09:00"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono"
                    />
                    <p className="text-xs text-gray-400 mt-1">
                      {s.scheduleMode === 'scheduled'
                        ? `${s.scheduleTimes.split(',').length}回の実行時刻に${s.postsPerDay}件を分配して予約します`
                        : s.scheduleMode === 'draft'
                        ? `各実行時刻に${Math.ceil(s.postsPerDay / (s.scheduleTimes.split(',').length || 1))}件を下書きとして保存します`
                        : `各実行時刻に${Math.ceil(s.postsPerDay / (s.scheduleTimes.split(',').length || 1))}件を即時投稿します`
                      }
                    </p>
                  </div>

                  {/* Themes (only for new tweets) */}
                  {config.hasThemes && (
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">
                        テーマ（カンマ区切り）
                      </label>
                      <textarea
                        value={s.themes}
                        onChange={(e) => updateSetting(postType, 'themes', e.target.value)}
                        placeholder="通訳案内士の日常,インバウンド観光,浅草ガイド体験"
                        rows={2}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-y"
                      />
                      <p className="text-xs text-gray-400 mt-1">
                        投稿ごとにテーマを順番に使用します
                      </p>
                    </div>
                  )}

                  {/* Theme Categories (only for new tweets) */}
                  {config.hasThemes && (
                    <div className="border border-gray-200 rounded-lg p-3 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <label className="block text-xs font-medium text-gray-700">
                            テーマカテゴリ
                          </label>
                          <p className="text-xs text-gray-400 mt-0.5">
                            直近3件と同じカテゴリは自動回避されます
                          </p>
                        </div>
                        <button
                          onClick={addCategory}
                          className="px-2 py-1 text-xs font-medium text-blue-600 border border-blue-300 rounded hover:bg-blue-50 transition-colors"
                        >
                          + 追加
                        </button>
                      </div>
                      {themeCategories.length === 0 ? (
                        <p className="text-xs text-gray-400 text-center py-2">
                          カテゴリ未設定（設定するとテーマの偏りを防ぎます）
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {themeCategories.map((cat, idx) => (
                            <div key={idx} className="flex items-start gap-2">
                              <input
                                type="text"
                                value={cat.code}
                                onChange={(e) => updateCategory(idx, 'code', e.target.value)}
                                placeholder="T-A"
                                className="w-14 px-2 py-1.5 border border-gray-300 rounded text-xs font-mono flex-shrink-0"
                              />
                              <input
                                type="text"
                                value={cat.name}
                                onChange={(e) => updateCategory(idx, 'name', e.target.value)}
                                placeholder="カテゴリ名"
                                className="w-36 px-2 py-1.5 border border-gray-300 rounded text-xs flex-shrink-0"
                              />
                              <input
                                type="text"
                                value={cat.description || ''}
                                onChange={(e) => updateCategory(idx, 'description', e.target.value)}
                                placeholder="説明（任意）"
                                className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-xs"
                              />
                              <button
                                onClick={() => removeCategory(idx)}
                                className="px-1.5 py-1.5 text-red-400 hover:text-red-600 text-xs flex-shrink-0"
                                title="削除"
                              >
                                x
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      {themeCategories.length > 0 && (
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            onClick={saveThemeCategories}
                            disabled={categorySaving}
                            className="px-3 py-1.5 text-xs font-medium bg-gray-100 text-gray-700 border border-gray-300 rounded hover:bg-gray-200 disabled:opacity-50 transition-colors"
                          >
                            {categorySaving ? '保存中...' : 'カテゴリを保存'}
                          </button>
                          {categorySaved && (
                            <span className="text-xs text-green-600">保存しました</span>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Tone */}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">トーン</label>
                    <select
                      value={s.tone}
                      onChange={(e) => updateSetting(postType, 'tone', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    >
                      <option value="">指定なし（デフォルト）</option>
                      <option value="カジュアル">カジュアル</option>
                      <option value="プロフェッショナル">プロフェッショナル</option>
                      <option value="フレンドリー">フレンドリー</option>
                      <option value="熱量高め">熱量高め</option>
                      <option value="淡々と">淡々と</option>
                    </select>
                  </div>

                  {/* Target audience */}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">ターゲット層</label>
                    <input
                      type="text"
                      value={s.targetAudience}
                      onChange={(e) => updateSetting(postType, 'targetAudience', e.target.value)}
                      placeholder="例: インバウンド事業者, 通訳案内士を目指す人"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                  </div>

                  {/* Style note */}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">スタイル補足</label>
                    <textarea
                      value={s.styleNote}
                      onChange={(e) => updateSetting(postType, 'styleNote', e.target.value)}
                      placeholder="例: 浅草エリアの話題を多めに, 数字を積極的に使う"
                      rows={2}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-y"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    {/* AI Model */}
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">AIモデル</label>
                      <select
                        value={s.aiModel}
                        onChange={(e) => updateSetting(postType, 'aiModel', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      >
                        {AI_MODELS.map(m => (
                          <option key={m.id} value={m.id}>{m.label}</option>
                        ))}
                      </select>
                    </div>

                    {/* Max length */}
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">
                        文字数上限 {s.maxLength > 0 ? `(${s.maxLength}文字)` : '(デフォルト)'}
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={500}
                        step={10}
                        value={s.maxLength || ''}
                        onChange={(e) => updateSetting(postType, 'maxLength', parseInt(e.target.value) || 0)}
                        placeholder="0 = デフォルト"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      />
                      <p className="text-xs text-gray-400 mt-1">
                        0の場合はプロンプトのデフォルト値を使用
                      </p>
                    </div>
                  </div>

                  {/* Last run info */}
                  {s.lastRunDate && (
                    <div className="text-xs text-gray-400">
                      最終実行: {s.lastRunDate} ({s.lastRunTimes || '-'})
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
                    <button
                      onClick={() => handleSave(postType)}
                      disabled={saving === postType}
                      className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    >
                      {saving === postType ? '保存中...' : '保存'}
                    </button>
                    <button
                      onClick={() => handleManualRun(postType)}
                      disabled={running === postType}
                      className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
                    >
                      {running === postType ? 'AI生成中...' : '今すぐ生成（下書き）'}
                    </button>
                    {saved === postType && (
                      <span className="text-sm text-green-600">保存しました</span>
                    )}
                    {saveError && saveError.postType === postType && (
                      <span className="text-sm text-red-600">{saveError.message}</span>
                    )}
                  </div>

                  {/* Draft creation notification */}
                  {draftResult && draftResult.postType === postType && draftResult.drafts > 0 && (
                    <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg p-3">
                      <span className="text-sm text-green-800">
                        {draftResult.drafts}件の下書きを作成しました。投稿管理ページで確認・編集してください。
                      </span>
                      <button
                        onClick={() => navigate('/post')}
                        className="px-3 py-1.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors flex-shrink-0 ml-3"
                      >
                        下書きを確認
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Cost estimate */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <h3 className="font-semibold text-gray-700 mb-2 text-sm">API料金の見積もり（月間）</h3>
            <div className="space-y-1 text-xs text-gray-600">
              {['new', 'reply', 'quote'].map(type => {
                const s = getSetting(type);
                if (!s.enabled) return null;
                const aiCost = s.postsPerDay * 30 * 0.002;
                const xCost = s.postsPerDay * 30 * 0.01;
                return (
                  <div key={type} className="flex justify-between">
                    <span>{POST_TYPE_CONFIG[type].label} ({s.postsPerDay}件/日)</span>
                    <span>AI: ${aiCost.toFixed(2)} + X API: ${xCost.toFixed(2)} = ${(aiCost + xCost).toFixed(2)}</span>
                  </div>
                );
              })}
              <div className="flex justify-between font-medium text-gray-800 pt-1 border-t border-gray-300">
                <span>合計</span>
                <span>
                  ${['new', 'reply', 'quote'].reduce((sum, type) => {
                    const s = getSetting(type);
                    if (!s.enabled) return sum;
                    return sum + s.postsPerDay * 30 * 0.012;
                  }, 0).toFixed(2)}/月
                </span>
              </div>
            </div>
          </div>
        </>
      )}

      {activeTab === 'logs' && (() => {
        const totalPages = Math.ceil(logTotal / LOG_PER_PAGE);
        return (
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">実行ログ</h3>
              {logTotal > 0 && (
                <span className="text-xs text-gray-500">{logTotal}件</span>
              )}
            </div>
            {logs.length === 0 ? (
              <div className="px-4 py-8 text-center text-gray-400 text-sm">
                実行ログはまだありません
              </div>
            ) : (
              <>
                <div className="divide-y divide-gray-100">
                  {logs.map(log => {
                    const statusInfo = STATUS_LABELS[log.status] || STATUS_LABELS.failed;
                    const config = POST_TYPE_CONFIG[log.post_type];
                    return (
                      <div key={log.id} className="px-4 py-3 space-y-1">
                        <div className="flex items-center gap-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${COLOR_MAP[config?.color || 'blue'].badge}`}>
                            {config?.label || log.post_type}
                          </span>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${statusInfo.className}`}>
                            {statusInfo.text}
                          </span>
                          <div className="flex-1 text-xs text-gray-600">
                            生成: {log.posts_generated}件
                            {log.posts_scheduled > 0 && ` / 予約: ${log.posts_scheduled}件`}
                            {log.posts_posted > 0 && ` / 投稿: ${log.posts_posted}件`}
                            {log.posts_generated > 0 && log.posts_scheduled === 0 && log.posts_posted === 0 && ` / 下書き: ${log.posts_generated}件`}
                          </div>
                          <span className="text-xs text-gray-400 flex-shrink-0">
                            {formatTime(log.executed_at)}
                          </span>
                        </div>
                        {log.error_message && (
                          <div className={`rounded px-3 py-2 text-xs ${
                            log.status === 'failed'
                              ? 'bg-red-50 border border-red-200 text-red-700'
                              : 'bg-gray-50 border border-gray-200 text-gray-600'
                          }`}>
                            {log.error_message}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {totalPages > 1 && (
                  <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
                    <button
                      onClick={() => loadLogs(logPage - 1)}
                      disabled={logPage === 0}
                      className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      前へ
                    </button>
                    <span className="text-xs text-gray-500">
                      {logPage + 1} / {totalPages} ページ
                    </span>
                    <button
                      onClick={() => loadLogs(logPage + 1)}
                      disabled={logPage >= totalPages - 1}
                      className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      次へ
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })()}
    </div>
  );
}

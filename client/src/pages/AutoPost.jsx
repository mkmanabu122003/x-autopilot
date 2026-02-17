import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAPI } from '../hooks/useAPI';
import { useAccount } from '../contexts/AccountContext';

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
  const [saved, setSaved] = useState(false);
  const [running, setRunning] = useState(null);
  const [activeTab, setActiveTab] = useState('settings');
  const [draftResult, setDraftResult] = useState(null);

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

  const loadLogs = useCallback(async () => {
    if (!currentAccount) return;
    try {
      const data = await get(`/auto-post/logs?accountId=${currentAccount.id}&limit=30`);
      setLogs(data);
    } catch (e) {
      setLogs([]);
    }
  }, [get, currentAccount]);

  useEffect(() => {
    loadSettings();
    loadLogs();
  }, [loadSettings, loadLogs]);

  const getDefault = (postType) => ({
    enabled: false,
    postsPerDay: postType === 'reply' ? 2 : 3,
    scheduleTimes: postType === 'new' ? '09:00' : postType === 'reply' ? '10:00,13:00' : '11:00',
    scheduleMode: postType === 'reply' ? 'immediate' : 'scheduled',
    themes: '',
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
    try {
      await put('/auto-post/settings', {
        accountId: currentAccount.id,
        postType,
        enabled: s.enabled,
        postsPerDay: s.postsPerDay,
        scheduleTimes: s.scheduleTimes,
        scheduleMode: s.scheduleMode,
        themes: s.themes,
      });
      setSaved(postType);
      setTimeout(() => setSaved(false), 2000);
      await loadSettings();
    } catch (e) {
      // error shown via useAPI
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
    <div className="space-y-6 max-w-3xl">
      {/* Loading overlay during AI generation */}
      {running && (
        <div className="fixed inset-0 bg-white/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
            <p className="text-sm font-medium text-gray-700">
              {POST_TYPE_CONFIG[running]?.label || ''}をAI生成中...
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
                      {s.scheduleMode === 'scheduled' ? '予約投稿' : '即時投稿'}
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
                      disabled={loading}
                      className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    >
                      保存
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

      {activeTab === 'logs' && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
            <h3 className="font-semibold text-gray-900">実行ログ</h3>
          </div>
          {logs.length === 0 ? (
            <div className="px-4 py-8 text-center text-gray-400 text-sm">
              実行ログはまだありません
            </div>
          ) : (
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
          )}
        </div>
      )}
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import { useAPI } from '../hooks/useAPI';
import { useAccount } from '../contexts/AccountContext';
import { formatDate } from '../utils/formatters';
import FeedbackRuleModal from './FeedbackRuleModal';

export default function DraftList() {
  const [drafts, setDrafts] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [schedulingId, setSchedulingId] = useState(null);
  const [scheduleTime, setScheduleTime] = useState('');
  const [posting, setPosting] = useState(null);
  const { get, put, post, del, loading } = useAPI();
  const { currentAccount } = useAccount();

  // Feedback regeneration state
  const [feedbackId, setFeedbackId] = useState(null);
  const [feedbackText, setFeedbackText] = useState('');
  const [regenerating, setRegenerating] = useState(false);
  const [regenCandidates, setRegenCandidates] = useState([]);
  const [regenError, setRegenError] = useState(null);
  // Per-draft feedback history: { [draftId]: string[] }
  const [feedbackHistories, setFeedbackHistories] = useState({});
  // Feedback rule modal state
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [ruleModalFeedbackHistory, setRuleModalFeedbackHistory] = useState([]);
  const [pendingPostDraftId, setPendingPostDraftId] = useState(null);
  const [ruleSavedCount, setRuleSavedCount] = useState(null);

  const fetchDrafts = async () => {
    try {
      const data = await get('/tweets/drafts');
      setDrafts(data);
    } catch (err) {
      // ignore
    }
  };

  useEffect(() => {
    fetchDrafts();
  }, []);

  const handleDelete = async (id) => {
    if (!window.confirm('この下書きを削除しますか？')) return;
    try {
      await del(`/tweets/drafts/${id}`);
      setDrafts(prev => prev.filter(d => d.id !== id));
      // Clean up feedback history
      setFeedbackHistories(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (err) {
      // ignore
    }
  };

  const handleEdit = (draft) => {
    setEditingId(draft.id);
    setEditText(draft.text);
  };

  const handleSaveEdit = async () => {
    try {
      await put(`/tweets/drafts/${editingId}`, { text: editText });
      setEditingId(null);
      fetchDrafts();
    } catch (err) {
      // ignore
    }
  };

  const handlePostNow = async (id) => {
    const history = feedbackHistories[id];
    if (history && history.length > 0) {
      // Has feedback history - show rule modal before posting
      setPendingPostDraftId(id);
      setRuleModalFeedbackHistory(history);
      setShowRuleModal(true);
      return;
    }
    // No feedback history - post directly
    await executePost(id);
  };

  const executePost = async (id) => {
    if (!window.confirm('この下書きを今すぐ投稿しますか？')) return;
    setPosting(id);
    try {
      await post(`/tweets/drafts/${id}/post`);
      setDrafts(prev => prev.filter(d => d.id !== id));
      // Clean up feedback history
      setFeedbackHistories(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (err) {
      alert(`投稿エラー: ${err.message}`);
    } finally {
      setPosting(null);
    }
  };

  const handleRuleModalClose = () => {
    setShowRuleModal(false);
    const draftId = pendingPostDraftId;
    setPendingPostDraftId(null);
    setRuleModalFeedbackHistory([]);
    if (draftId) {
      executePost(draftId);
    }
  };

  const handleRuleSaved = (count) => {
    setRuleSavedCount(count);
    setTimeout(() => setRuleSavedCount(null), 3000);
  };

  const handleSchedule = async (id) => {
    if (!scheduleTime) return;
    try {
      await post(`/tweets/drafts/${id}/schedule`, {
        scheduledAt: new Date(scheduleTime).toISOString()
      });
      setSchedulingId(null);
      setScheduleTime('');
      setDrafts(prev => prev.filter(d => d.id !== id));
    } catch (err) {
      // ignore
    }
  };

  // Feedback regeneration handlers
  const openFeedback = (draftId) => {
    setFeedbackId(draftId);
    setFeedbackText('');
    setRegenCandidates([]);
    setRegenError(null);
  };

  const closeFeedback = () => {
    setFeedbackId(null);
    setFeedbackText('');
    setRegenCandidates([]);
    setRegenError(null);
  };

  const handleRegenerate = async (draft) => {
    if (!feedbackText.trim()) return;
    setRegenerating(true);
    setRegenError(null);
    setRegenCandidates([]);
    try {
      const result = await post('/ai/regenerate', {
        originalText: draft.text,
        feedback: feedbackText,
        postType: draft.post_type,
        accountId: currentAccount?.id
      });
      setRegenCandidates(result.candidates || []);
      // Record feedback in history
      setFeedbackHistories(prev => ({
        ...prev,
        [draft.id]: [...(prev[draft.id] || []), feedbackText]
      }));
    } catch (err) {
      setRegenError(err.message);
    } finally {
      setRegenerating(false);
    }
  };

  const handleSelectCandidate = async (draft, candidate) => {
    try {
      await put(`/tweets/drafts/${draft.id}`, { text: candidate.text });
      setRegenCandidates([]);
      setFeedbackText('');
      fetchDrafts();
    } catch (err) {
      // ignore
    }
  };

  const postTypeLabel = (type) => {
    switch (type) {
      case 'reply': return 'リプライ';
      case 'quote': return '引用RT';
      default: return '新規';
    }
  };

  const postTypeBadgeClass = (type) => {
    switch (type) {
      case 'reply': return 'bg-green-100 text-green-700';
      case 'quote': return 'bg-purple-100 text-purple-700';
      default: return 'bg-blue-100 text-blue-700';
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="font-semibold text-gray-900">下書き一覧</h3>

      {ruleSavedCount !== null && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700">
          {ruleSavedCount}件のフィードバックルールをプロンプトに反映しました
        </div>
      )}

      {drafts.length === 0 && (
        <p className="text-sm text-gray-400 py-4 text-center">下書きはありません</p>
      )}
      {drafts.map(draft => (
        <div key={draft.id} className="border border-gray-200 rounded-lg p-3">
          {editingId === draft.id ? (
            <div className="space-y-2">
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleSaveEdit}
                  disabled={loading}
                  className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  保存
                </button>
                <button
                  onClick={() => setEditingId(null)}
                  className="px-3 py-1 text-xs text-gray-600 border border-gray-300 rounded hover:bg-gray-50"
                >
                  キャンセル
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <span className={`inline-block px-2 py-0.5 text-xs rounded mb-1 ${postTypeBadgeClass(draft.post_type)}`}>
                    {postTypeLabel(draft.post_type)}
                  </span>
                  {draft.ai_provider && (
                    <span className="inline-block px-2 py-0.5 text-xs bg-gray-100 text-gray-500 rounded mb-1 ml-1">
                      {draft.ai_provider}
                    </span>
                  )}
                  {feedbackHistories[draft.id]?.length > 0 && (
                    <span className="inline-block px-2 py-0.5 text-xs bg-amber-100 text-amber-700 rounded mb-1 ml-1">
                      FB {feedbackHistories[draft.id].length}回
                    </span>
                  )}
                  {draft.target_tweet && (draft.post_type === 'reply' || draft.post_type === 'quote') && (
                    <div className="bg-gray-50 border border-gray-200 rounded px-3 py-2 mb-2">
                      <p className="text-xs text-gray-500 mb-0.5">
                        {draft.post_type === 'reply' ? 'リプライ先' : '引用元'}:
                        <span className="font-medium text-gray-700 ml-1">
                          @{draft.target_tweet.handle}
                          {draft.target_tweet.name && ` (${draft.target_tweet.name})`}
                        </span>
                      </p>
                      <p className="text-xs text-gray-600 break-words">{draft.target_tweet.text}</p>
                    </div>
                  )}
                  <p className="text-sm text-gray-800 break-words whitespace-pre-wrap">{draft.text}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    作成: {formatDate(draft.created_at)}
                  </p>
                </div>
              </div>

              {/* Feedback regeneration area */}
              {feedbackId === draft.id && (
                <div className="border border-amber-200 bg-amber-50 rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-amber-700">AI フィードバック再生成</span>
                    <button
                      onClick={closeFeedback}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  {feedbackHistories[draft.id]?.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {feedbackHistories[draft.id].map((fb, i) => (
                        <span key={i} className="inline-block px-2 py-0.5 text-xs bg-amber-200 text-amber-800 rounded">
                          {fb}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={feedbackText}
                      onChange={(e) => setFeedbackText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey && feedbackText.trim()) {
                          e.preventDefault();
                          handleRegenerate(draft);
                        }
                      }}
                      placeholder="例: もっとカジュアルに、数字を入れて"
                      className="flex-1 px-3 py-1.5 border border-amber-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-400 focus:border-transparent bg-white"
                    />
                    <button
                      onClick={() => handleRegenerate(draft)}
                      disabled={regenerating || !feedbackText.trim()}
                      className="px-3 py-1.5 text-xs bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                    >
                      {regenerating ? '生成中...' : '再生成'}
                    </button>
                  </div>

                  {regenError && <p className="text-xs text-red-500">{regenError}</p>}

                  {regenCandidates.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-amber-700">候補を選択して下書きを更新:</p>
                      {regenCandidates.map((c, i) => (
                        <button
                          key={i}
                          onClick={() => handleSelectCandidate(draft, c)}
                          className="w-full text-left p-2 border border-amber-200 rounded-lg hover:border-amber-400 hover:bg-amber-100 transition-colors bg-white"
                        >
                          <p className="text-sm text-gray-800 whitespace-pre-wrap">{c.text}</p>
                          {c.label && (
                            <p className="text-xs text-amber-600 mt-1">{c.label}</p>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {schedulingId === draft.id ? (
                <div className="flex items-center gap-2">
                  <input
                    type="datetime-local"
                    value={scheduleTime}
                    onChange={(e) => setScheduleTime(e.target.value)}
                    className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
                  />
                  <button
                    onClick={() => handleSchedule(draft.id)}
                    disabled={loading || !scheduleTime}
                    className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                  >
                    予約
                  </button>
                  <button
                    onClick={() => { setSchedulingId(null); setScheduleTime(''); }}
                    className="px-3 py-1 text-xs text-gray-600 border border-gray-300 rounded hover:bg-gray-50"
                  >
                    キャンセル
                  </button>
                </div>
              ) : (
                <div className="flex gap-1 flex-wrap">
                  <button
                    onClick={() => handlePostNow(draft.id)}
                    disabled={posting === draft.id}
                    className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {posting === draft.id ? '投稿中...' : '今すぐ投稿'}
                  </button>
                  <button
                    onClick={() => setSchedulingId(draft.id)}
                    className="px-3 py-1 text-xs text-blue-600 border border-blue-200 rounded hover:bg-blue-50 transition-colors"
                  >
                    予約
                  </button>
                  <button
                    onClick={() => openFeedback(draft.id)}
                    disabled={feedbackId === draft.id}
                    className="px-3 py-1 text-xs text-amber-600 border border-amber-200 rounded hover:bg-amber-50 transition-colors"
                  >
                    AI再生成
                  </button>
                  <button
                    onClick={() => handleEdit(draft)}
                    className="px-3 py-1 text-xs text-gray-600 hover:bg-gray-50 rounded transition-colors"
                  >
                    編集
                  </button>
                  <button
                    onClick={() => handleDelete(draft.id)}
                    className="px-3 py-1 text-xs text-red-600 hover:bg-red-50 rounded transition-colors"
                  >
                    削除
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      {showRuleModal && (
        <FeedbackRuleModal
          feedbackHistory={ruleModalFeedbackHistory}
          onClose={handleRuleModalClose}
          onSaved={handleRuleSaved}
        />
      )}
    </div>
  );
}

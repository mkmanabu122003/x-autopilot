import React, { useState, useEffect } from 'react';
import { useAPI } from '../hooks/useAPI';
import { formatDate } from '../utils/formatters';

export default function DraftList() {
  const [drafts, setDrafts] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [schedulingId, setSchedulingId] = useState(null);
  const [scheduleTime, setScheduleTime] = useState('');
  const [posting, setPosting] = useState(null);
  const { get, put, post, del, loading } = useAPI();

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
      setDrafts(drafts.filter(d => d.id !== id));
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
    if (!window.confirm('この下書きを今すぐ投稿しますか？')) return;
    setPosting(id);
    try {
      await post(`/tweets/drafts/${id}/post`);
      setDrafts(drafts.filter(d => d.id !== id));
    } catch (err) {
      alert(`投稿エラー: ${err.message}`);
    } finally {
      setPosting(null);
    }
  };

  const handleSchedule = async (id) => {
    if (!scheduleTime) return;
    try {
      await post(`/tweets/drafts/${id}/schedule`, {
        scheduledAt: new Date(scheduleTime).toISOString()
      });
      setSchedulingId(null);
      setScheduleTime('');
      setDrafts(drafts.filter(d => d.id !== id));
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
                  <p className="text-sm text-gray-800 break-words">{draft.text}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    作成: {formatDate(draft.created_at)}
                  </p>
                </div>
              </div>

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
    </div>
  );
}

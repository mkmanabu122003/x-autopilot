import React, { useState, useEffect } from 'react';
import { useAPI } from '../hooks/useAPI';
import { formatDate } from '../utils/formatters';

// Convert a UTC/ISO date string to local datetime-local input value (YYYY-MM-DDTHH:mm)
function toLocalDatetimeValue(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export default function ScheduleList() {
  const [posts, setPosts] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [editTime, setEditTime] = useState('');
  const { get, post: apiPost, put, del, loading } = useAPI();

  const fetchPosts = async () => {
    try {
      const data = await get('/tweets/scheduled');
      setPosts(data);
    } catch (err) {
      // ignore
    }
  };

  useEffect(() => {
    fetchPosts();
    const interval = setInterval(fetchPosts, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleDelete = async (id) => {
    try {
      await del(`/tweets/scheduled/${id}`);
      setPosts(posts.filter(p => p.id !== id));
    } catch (err) {
      // ignore
    }
  };

  const handleRetry = async (id) => {
    try {
      await apiPost(`/tweets/scheduled/${id}/retry`);
      fetchPosts();
    } catch (err) {
      // ignore
    }
  };

  const handleEdit = (post) => {
    setEditingId(post.id);
    setEditText(post.text);
    setEditTime(toLocalDatetimeValue(post.scheduled_at));
  };

  const handleSave = async () => {
    try {
      await put(`/tweets/scheduled/${editingId}`, {
        text: editText,
        scheduledAt: editTime ? new Date(editTime).toISOString() : undefined
      });
      setEditingId(null);
      fetchPosts();
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

  return (
    <div className="space-y-3">
      <h3 className="font-semibold text-gray-900">予約投稿一覧</h3>
      {posts.length === 0 && (
        <p className="text-sm text-gray-400 py-4 text-center">予約投稿はありません</p>
      )}
      {posts.map(post => (
        <div key={post.id} className={`border rounded-lg p-3 ${post.status === 'failed' ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}>
          {editingId === post.id ? (
            <div className="space-y-2">
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none"
              />
              <input
                type="datetime-local"
                value={editTime}
                onChange={(e) => setEditTime(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleSave}
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
            <div>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 mb-1">
                    <span className="inline-block px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">
                      {postTypeLabel(post.post_type)}
                    </span>
                    {post.status === 'failed' && (
                      <span className="inline-block px-2 py-0.5 text-xs bg-red-100 text-red-700 rounded font-medium">
                        投稿失敗
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-800 break-words">{post.text}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    予定: {formatDate(post.scheduled_at)}
                  </p>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  {post.status === 'failed' ? (
                    <>
                      <button
                        onClick={() => handleRetry(post.id)}
                        disabled={loading}
                        className="px-2 py-1 text-xs text-orange-600 hover:bg-orange-50 rounded transition-colors"
                      >
                        再試行
                      </button>
                      <button
                        onClick={() => handleDelete(post.id)}
                        className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded transition-colors"
                      >
                        削除
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => handleEdit(post)}
                        className="px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded transition-colors"
                      >
                        編集
                      </button>
                      <button
                        onClick={() => handleDelete(post.id)}
                        className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded transition-colors"
                      >
                        削除
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

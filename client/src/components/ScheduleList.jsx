import React, { useState, useEffect } from 'react';
import { useAPI } from '../hooks/useAPI';
import { formatDate } from '../utils/formatters';

export default function ScheduleList() {
  const [posts, setPosts] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [editTime, setEditTime] = useState('');
  const { get, put, del, loading } = useAPI();

  const fetchPosts = async () => {
    try {
      const data = await get('/tweets/scheduled');
      setPosts(data);
    } catch (err) {
      // ignore
    }
  };

  useEffect(() => { fetchPosts(); }, []);

  const handleDelete = async (id) => {
    try {
      await del(`/tweets/scheduled/${id}`);
      setPosts(posts.filter(p => p.id !== id));
    } catch (err) {
      // ignore
    }
  };

  const handleEdit = (post) => {
    setEditingId(post.id);
    setEditText(post.text);
    setEditTime(post.scheduled_at ? post.scheduled_at.slice(0, 16) : '');
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
        <div key={post.id} className="border border-gray-200 rounded-lg p-3">
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
                  <span className="inline-block px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded mb-1">
                    {postTypeLabel(post.post_type)}
                  </span>
                  <p className="text-sm text-gray-800 break-words">{post.text}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    予定: {formatDate(post.scheduled_at)}
                  </p>
                </div>
                <div className="flex gap-1 flex-shrink-0">
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
                </div>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

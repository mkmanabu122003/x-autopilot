import React, { useState, useEffect } from 'react';
import { useAPI } from '../hooks/useAPI';
import { formatNumber, formatDate } from '../utils/formatters';

export default function Competitors() {
  const [competitors, setCompetitors] = useState([]);
  const [handle, setHandle] = useState('');
  const [fetching, setFetching] = useState(false);
  const { get, post, del, loading, error } = useAPI();

  const fetchCompetitors = async () => {
    try {
      const data = await get('/competitors');
      setCompetitors(data);
    } catch (err) {
      // ignore
    }
  };

  useEffect(() => { fetchCompetitors(); }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!handle.trim()) return;
    try {
      await post('/competitors', { handle: handle.trim() });
      setHandle('');
      fetchCompetitors();
    } catch (err) {
      // error from hook
    }
  };

  const handleDelete = async (id) => {
    try {
      await del(`/competitors/${id}`);
      setCompetitors(competitors.filter(c => c.id !== id));
    } catch (err) {
      // ignore
    }
  };

  const handleFetchAll = async () => {
    setFetching(true);
    try {
      await post('/competitors/fetch', {});
    } catch (err) {
      // ignore
    } finally {
      setFetching(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">競合管理</h2>
        <button
          onClick={handleFetchAll}
          disabled={fetching}
          className="px-3 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
        >
          {fetching ? '取得中...' : '全競合ツイート取得'}
        </button>
      </div>

      {/* Add form */}
      <form onSubmit={handleAdd} className="flex gap-2">
        <input
          type="text"
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          placeholder="@handle を入力"
          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <button
          type="submit"
          disabled={loading || !handle.trim()}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          追加
        </button>
      </form>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* Competitor list */}
      <div className="space-y-3">
        {competitors.length === 0 && (
          <p className="text-sm text-gray-400 py-8 text-center">
            監視対象アカウントがありません
          </p>
        )}
        {competitors.map(c => (
          <div key={c.id} className="bg-white border border-gray-200 rounded-lg p-4 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-medium text-gray-900">@{c.handle}</p>
                {c.name && <span className="text-sm text-gray-500">{c.name}</span>}
              </div>
              <div className="flex flex-wrap gap-3 mt-1 text-xs text-gray-400">
                <span>フォロワー: {formatNumber(c.followers_count)}</span>
                <span>ツイート取得数: {c.tweet_count || 0}</span>
                <span>追加日: {formatDate(c.created_at)}</span>
              </div>
            </div>
            <button
              onClick={() => handleDelete(c.id)}
              className="px-3 py-1 text-xs text-red-600 border border-red-200 rounded hover:bg-red-50 transition-colors flex-shrink-0"
            >
              削除
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

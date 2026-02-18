import React, { useState, useEffect } from 'react';
import { useAPI } from '../hooks/useAPI';
import { useAccount } from '../contexts/AccountContext';
import { formatNumber, formatPercent, formatRelativeTime } from '../utils/formatters';

const POST_TYPE_LABELS = {
  new: '新規',
  reply: 'リプライ',
  quote: '引用RT'
};

export default function OwnPostsTable() {
  const [posts, setPosts] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const { get, post } = useAPI();
  const { currentAccount } = useAccount();

  const fetchPosts = () => {
    const params = new URLSearchParams({ limit: '20' });
    if (currentAccount) params.set('accountId', currentAccount.id);
    get(`/growth/own-posts?${params}`).then(setPosts).catch(() => {});
  };

  useEffect(() => {
    fetchPosts();
  }, [get, currentAccount]);

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await post('/growth/refresh-metrics', { accountId: currentAccount?.id });
      fetchPosts();
    } catch {
      // ignore
    }
    setRefreshing(false);
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-900">自分の投稿パフォーマンス</h3>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="px-3 py-1 text-xs bg-blue-50 text-blue-600 rounded hover:bg-blue-100 transition-colors disabled:opacity-50"
        >
          {refreshing ? '更新中...' : '指標を更新'}
        </button>
      </div>
      <div className="space-y-3">
        {posts.length === 0 && (
          <p className="text-sm text-gray-400 py-4 text-center">投稿データがありません</p>
        )}
        {posts.map((p, i) => (
          <div key={p.id} className="border border-gray-100 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                    p.post_type === 'new' ? 'bg-blue-50 text-blue-600' :
                    p.post_type === 'quote' ? 'bg-purple-50 text-purple-600' :
                    'bg-green-50 text-green-600'
                  }`}>
                    {POST_TYPE_LABELS[p.post_type] || p.post_type}
                  </span>
                  <span className="text-xs text-gray-400">
                    {p.posted_at ? formatRelativeTime(p.posted_at) : '-'}
                  </span>
                </div>
                <p className="text-sm text-gray-800 break-words line-clamp-2">{p.text}</p>
                {p.target_tweet_id && (p.post_type === 'reply' || p.post_type === 'quote') && (
                  <div className="mt-1.5 pl-2 border-l-2 border-gray-200">
                    {p.target_tweet ? (
                      <a
                        href={`https://x.com/${p.target_tweet.handle}/status/${p.target_tweet_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block hover:bg-gray-50 rounded transition-colors"
                      >
                        <span className="text-xs text-gray-500">
                          {p.post_type === 'quote' ? '引用元' : '返信先'}:
                          {' '}
                          <span className="font-medium text-gray-700">
                            {p.target_tweet.name || `@${p.target_tweet.handle}`}
                          </span>
                          {p.target_tweet.name && (
                            <span className="text-gray-400 ml-1">@{p.target_tweet.handle}</span>
                          )}
                        </span>
                        <p className="text-xs text-gray-400 line-clamp-1 mt-0.5">{p.target_tweet.text}</p>
                      </a>
                    ) : (
                      <a
                        href={`https://x.com/i/web/status/${p.target_tweet_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-500 hover:underline"
                      >
                        {p.post_type === 'quote' ? '引用元' : '返信先'}: {p.target_tweet_id}
                      </a>
                    )}
                  </div>
                )}
                <div className="flex flex-wrap gap-3 mt-2 text-xs text-gray-500">
                  <span className={`font-medium ${(p.engagement_rate || 0) > 2 ? 'text-green-600' : 'text-gray-600'}`}>
                    ER: {formatPercent(p.engagement_rate || 0)}
                  </span>
                  <span>👁 {formatNumber(p.impression_count || 0)}</span>
                  <span>♥ {formatNumber(p.like_count || 0)}</span>
                  <span>RT {formatNumber(p.retweet_count || 0)}</span>
                  <span>💬 {formatNumber(p.reply_count || 0)}</span>
                  {(p.bookmark_count || 0) > 0 && (
                    <span>🔖 {formatNumber(p.bookmark_count)}</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import { useAPI } from '../hooks/useAPI';
import { formatNumber, formatPercent, formatRelativeTime } from '../utils/formatters';

export default function TopPosts({ onQuote, onReply }) {
  const [posts, setPosts] = useState([]);
  const { get } = useAPI();

  useEffect(() => {
    get('/analytics/top-posts?limit=20').then(setPosts).catch(() => {});
  }, [get]);

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h3 className="font-semibold text-gray-900 mb-4">伸びてるポスト TOP ランキング</h3>
      <div className="space-y-3">
        {posts.length === 0 && (
          <p className="text-sm text-gray-400 py-4 text-center">データがありません</p>
        )}
        {posts.map((post, i) => (
          <div key={post.id} className="border border-gray-100 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <span className="text-xs font-bold text-gray-400 mt-1">#{i + 1}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-500 mb-1">
                  @{post.handle} &middot; {formatRelativeTime(post.created_at_x)}
                </p>
                <p className="text-sm text-gray-800 break-words">{post.text}</p>
                <div className="flex flex-wrap gap-3 mt-2 text-xs text-gray-500">
                  <span>ER: {formatPercent(post.engagement_rate)}</span>
                  <span>♥ {formatNumber(post.like_count)}</span>
                  <span>RT {formatNumber(post.retweet_count)}</span>
                  <span>💬 {formatNumber(post.reply_count)}</span>
                  <span>👁 {formatNumber(post.impression_count)}</span>
                </div>
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => onQuote && onQuote(post)}
                    className="px-3 py-1 text-xs bg-blue-50 text-blue-600 rounded hover:bg-blue-100 transition-colors"
                  >
                    引用RT
                  </button>
                  <button
                    onClick={() => onReply && onReply(post)}
                    className="px-3 py-1 text-xs bg-green-50 text-green-600 rounded hover:bg-green-100 transition-colors"
                  >
                    コメント
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

import React, { useState } from 'react';
import { useAPI } from '../hooks/useAPI';
import { charCount } from '../utils/formatters';
import AIGenerator from './AIGenerator';

const MAX_CHARS = 280;

export default function TweetComposer({ mode = 'new', targetTweetId: initialTarget, onPosted }) {
  const [text, setText] = useState('');
  const [targetTweetId, setTargetTweetId] = useState(initialTarget || '');
  const [scheduledAt, setScheduledAt] = useState('');
  const [showSchedule, setShowSchedule] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const { post, loading, error } = useAPI();

  const count = charCount(text);
  const isOverLimit = count > MAX_CHARS;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!text.trim() || isOverLimit) return;

    const endpoint = mode === 'reply' ? '/tweets/reply'
      : mode === 'quote' ? '/tweets/quote'
      : '/tweets';

    const body = { text };
    if (mode === 'reply' || mode === 'quote') {
      body.targetTweetId = targetTweetId;
    }
    if (scheduledAt) {
      body.scheduledAt = new Date(scheduledAt).toISOString();
    }

    try {
      await post(endpoint, body);
      setText('');
      setTargetTweetId('');
      setScheduledAt('');
      setShowSchedule(false);
      onPosted && onPosted();
    } catch (err) {
      // error is available via the hook
    }
  };

  const handleAISelect = (candidate) => {
    setText(candidate.text);
    setShowAI(false);
  };

  return (
    <div>
      <form onSubmit={handleSubmit} className="space-y-3">
        {(mode === 'reply' || mode === 'quote') && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {mode === 'reply' ? '返信先ツイートID' : '引用元ツイートID'}
            </label>
            <input
              type="text"
              value={targetTweetId}
              onChange={(e) => setTargetTweetId(e.target.value)}
              placeholder="ツイートIDを入力"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        )}

        <div className="relative">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              mode === 'reply' ? '返信内容を入力...'
              : mode === 'quote' ? '引用コメントを入力...'
              : 'いまどうしてる？'
            }
            rows={4}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <span className={`absolute bottom-2 right-2 text-xs ${isOverLimit ? 'text-red-500 font-bold' : 'text-gray-400'}`}>
            {count}/{MAX_CHARS}
          </span>
        </div>

        {showSchedule && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">投稿日時</label>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="submit"
            disabled={loading || !text.trim() || isOverLimit}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? '投稿中...' : scheduledAt ? '予約する' : '投稿する'}
          </button>
          <button
            type="button"
            onClick={() => setShowSchedule(!showSchedule)}
            className="px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            {showSchedule ? '即時投稿に戻す' : '予約投稿'}
          </button>
          <button
            type="button"
            onClick={() => setShowAI(true)}
            className="px-3 py-2 text-sm text-purple-600 border border-purple-300 rounded-lg hover:bg-purple-50 transition-colors"
          >
            AI生成
          </button>
        </div>
      </form>

      {showAI && (
        <AIGenerator
          postType={mode}
          onSelect={handleAISelect}
          onClose={() => setShowAI(false)}
        />
      )}
    </div>
  );
}

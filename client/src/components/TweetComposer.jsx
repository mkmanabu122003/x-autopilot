import React, { useState } from 'react';
import { useAPI } from '../hooks/useAPI';
import { useAccount } from '../contexts/AccountContext';
import { charCount } from '../utils/formatters';
import AIGenerator from './AIGenerator';
import PostConfirmDialog from './PostConfirmDialog';

const MAX_CHARS = 280;

export default function TweetComposer({ mode = 'new', targetTweetId: initialTarget, initialText = '', onPosted }) {
  const [text, setText] = useState(initialText);
  const [targetTweetId, setTargetTweetId] = useState(initialTarget || '');
  const [scheduledAt, setScheduledAt] = useState('');
  const [showSchedule, setShowSchedule] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const { post, loading, error } = useAPI();
  const { currentAccount, hasAccounts } = useAccount();

  const count = charCount(text);
  const isOverLimit = count > MAX_CHARS;

  const handleSubmitRequest = (e) => {
    e.preventDefault();
    if (!text.trim() || isOverLimit || !currentAccount) return;

    // Always show confirmation dialog to prevent wrong-account posts
    setShowConfirm(true);
  };

  const handleConfirmedSubmit = async () => {
    setShowConfirm(false);

    const endpoint = mode === 'reply' ? '/tweets/reply'
      : mode === 'quote' ? '/tweets/quote'
      : '/tweets';

    const body = { text, accountId: currentAccount.id };
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

  if (!hasAccounts) {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-center">
        <p className="text-sm text-yellow-800">
          投稿するにはXアカウントを登録してください。
        </p>
        <a href="/settings" className="text-sm text-blue-600 hover:underline mt-1 inline-block">
          設定画面でアカウントを追加
        </a>
      </div>
    );
  }

  return (
    <div>
      {/* Current account indicator */}
      {currentAccount && (
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-lg mb-3 border-l-4"
          style={{ borderLeftColor: currentAccount.color, backgroundColor: currentAccount.color + '10' }}
        >
          <span
            className="w-3 h-3 rounded-full flex-shrink-0"
            style={{ backgroundColor: currentAccount.color }}
          />
          <span className="text-sm font-bold text-gray-900">
            @{currentAccount.handle}
          </span>
          <span className="text-xs text-gray-500">に投稿</span>
        </div>
      )}

      <form onSubmit={handleSubmitRequest} className="space-y-3">
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
            className="w-full px-3 py-2 border-2 rounded-lg text-sm resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            style={{ borderColor: currentAccount?.color || '#D1D5DB' }}
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
            disabled={loading || !text.trim() || isOverLimit || !currentAccount}
            className="px-4 py-2 text-white text-sm font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            style={{ backgroundColor: currentAccount?.color || '#3B82F6' }}
          >
            {loading ? '投稿中...' : scheduledAt ? '予約する' : '投稿する'}
          </button>
          <button
            type="button"
            onClick={() => {
              const next = !showSchedule;
              setShowSchedule(next);
              if (!next) setScheduledAt('');
            }}
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

      {showConfirm && currentAccount && (
        <PostConfirmDialog
          account={currentAccount}
          text={text}
          onConfirm={handleConfirmedSubmit}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </div>
  );
}

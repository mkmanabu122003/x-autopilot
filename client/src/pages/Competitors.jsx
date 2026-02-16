import React, { useState, useEffect } from 'react';
import { useAPI } from '../hooks/useAPI';
import { useAccount } from '../contexts/AccountContext';
import { formatNumber, formatDate } from '../utils/formatters';

export default function Competitors() {
  const [competitors, setCompetitors] = useState([]);
  const [handle, setHandle] = useState('');
  const [fetching, setFetching] = useState(false);
  const { get, post, del, loading, error } = useAPI();
  const { currentAccount } = useAccount();

  // Auto-search state
  const [showSearch, setShowSearch] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [minFollowers, setMinFollowers] = useState('');
  const [maxFollowers, setMaxFollowers] = useState('');
  const [language, setLanguage] = useState('ja');
  const [minLikes, setMinLikes] = useState('');
  const [minRetweets, setMinRetweets] = useState('');
  const [hasMedia, setHasMedia] = useState(false);
  const [hasLinks, setHasLinks] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [candidates, setCandidates] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState(false);
  const [searchError, setSearchError] = useState('');

  // Keyword suggestions state
  const [suggestions, setSuggestions] = useState(null);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  const fetchCompetitors = async () => {
    try {
      const params = currentAccount ? `?accountId=${currentAccount.id}` : '';
      const data = await get(`/competitors${params}`);
      setCompetitors(data);
    } catch (err) {
      // ignore
    }
  };

  useEffect(() => { fetchCompetitors(); }, [currentAccount]);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!handle.trim()) return;
    try {
      await post('/competitors', {
        handle: handle.trim(),
        accountId: currentAccount?.id
      });
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

  // Keyword suggestion
  const handleSuggestKeywords = async () => {
    if (!currentAccount?.id) return;
    setLoadingSuggestions(true);
    try {
      const data = await post('/competitors/suggest-keywords', {
        accountId: currentAccount.id
      });
      setSuggestions(data);
    } catch (err) {
      // ignore
    } finally {
      setLoadingSuggestions(false);
    }
  };

  const applyKeyword = (word) => {
    setKeyword(word);
  };

  // Auto-search handlers
  const handleSearch = async (e) => {
    e.preventDefault();
    if (!keyword.trim()) return;
    setSearching(true);
    setSearchError('');
    setCandidates([]);
    setSelectedIds(new Set());
    try {
      const data = await post('/competitors/search', {
        keyword: keyword.trim(),
        minFollowers: minFollowers ? parseInt(minFollowers) : undefined,
        maxFollowers: maxFollowers ? parseInt(maxFollowers) : undefined,
        language: language || undefined,
        minLikes: minLikes ? parseInt(minLikes) : undefined,
        minRetweets: minRetweets ? parseInt(minRetweets) : undefined,
        hasMedia: hasMedia || undefined,
        hasLinks: hasLinks || undefined,
        accountId: currentAccount?.id
      });
      setCandidates(data);
      if (data.length === 0) {
        setSearchError('該当するアカウントが見つかりませんでした');
      }
    } catch (err) {
      setSearchError(err.message || '検索に失敗しました');
    } finally {
      setSearching(false);
    }
  };

  const toggleSelect = (userId) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === candidates.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(candidates.map(c => c.user_id)));
    }
  };

  const handleBulkAdd = async () => {
    if (selectedIds.size === 0) return;
    setAdding(true);
    try {
      const usersToAdd = candidates.filter(c => selectedIds.has(c.user_id));
      const result = await post('/competitors/bulk', {
        users: usersToAdd,
        accountId: currentAccount?.id
      });
      setCandidates(prev => prev.filter(c => !selectedIds.has(c.user_id)));
      setSelectedIds(new Set());
      fetchCompetitors();
      if (result.message) {
        setSearchError('');
      }
    } catch (err) {
      setSearchError(err.message || '追加に失敗しました');
    } finally {
      setAdding(false);
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

      {/* Manual add form */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-700">手動追加</h3>
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
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* Auto-search section */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">自動検索</h3>
          <button
            onClick={() => setShowSearch(!showSearch)}
            className="text-sm text-blue-600 hover:text-blue-700"
          >
            {showSearch ? '閉じる' : '検索パネルを開く'}
          </button>
        </div>

        {showSearch && (
          <div className="space-y-4">
            <p className="text-xs text-gray-500">
              キーワードで検索し、関連するアカウントを自動で発見します
            </p>

            {/* Keyword suggestions */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">キーワード候補</span>
                <button
                  type="button"
                  onClick={handleSuggestKeywords}
                  disabled={loadingSuggestions || !currentAccount?.id}
                  className="text-xs text-purple-600 hover:text-purple-700 disabled:opacity-50"
                >
                  {loadingSuggestions ? '分析中...' : 'AIで候補を提案'}
                </button>
              </div>

              {suggestions && (
                <div className="space-y-2">
                  {suggestions.profile && suggestions.profile.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-400 mb-1">プロフィールから提案</p>
                      <div className="flex flex-wrap gap-1.5">
                        {suggestions.profile.map((kw, i) => (
                          <button
                            key={`p-${i}`}
                            type="button"
                            onClick={() => applyKeyword(kw)}
                            className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                              keyword === kw
                                ? 'bg-purple-100 border-purple-400 text-purple-700'
                                : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-purple-50 hover:border-purple-300'
                            }`}
                          >
                            {kw}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {suggestions.competitor && suggestions.competitor.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-400 mb-1">競合ツイートの頻出ワード</p>
                      <div className="flex flex-wrap gap-1.5">
                        {suggestions.competitor.map((item, i) => (
                          <button
                            key={`c-${i}`}
                            type="button"
                            onClick={() => applyKeyword(item.word)}
                            className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                              keyword === item.word
                                ? 'bg-purple-100 border-purple-400 text-purple-700'
                                : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-purple-50 hover:border-purple-300'
                            }`}
                          >
                            {item.word}
                            <span className="ml-1 text-gray-400">({item.count})</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {(!suggestions.profile || suggestions.profile.length === 0) &&
                   (!suggestions.competitor || suggestions.competitor.length === 0) && (
                    <p className="text-xs text-gray-400">候補が見つかりませんでした</p>
                  )}
                </div>
              )}
            </div>

            <form onSubmit={handleSearch} className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">キーワード</label>
                <input
                  type="text"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="例: AI活用, マーケティング, プログラミング"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">最低フォロワー数</label>
                  <input
                    type="number"
                    value={minFollowers}
                    onChange={(e) => setMinFollowers(e.target.value)}
                    placeholder="例: 1000"
                    min="0"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">言語</label>
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                  >
                    <option value="ja">日本語</option>
                    <option value="en">英語</option>
                    <option value="">すべて</option>
                  </select>
                </div>
              </div>

              {/* Advanced parameters toggle */}
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
              >
                <span className={`inline-block transition-transform ${showAdvanced ? 'rotate-90' : ''}`}>&#9654;</span>
                詳細条件
              </button>

              {showAdvanced && (
                <div className="space-y-3 pl-2 border-l-2 border-purple-200">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">最大フォロワー数</label>
                      <input
                        type="number"
                        value={maxFollowers}
                        onChange={(e) => setMaxFollowers(e.target.value)}
                        placeholder="例: 100000"
                        min="0"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">最低いいね数</label>
                      <input
                        type="number"
                        value={minLikes}
                        onChange={(e) => setMinLikes(e.target.value)}
                        placeholder="例: 10"
                        min="0"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">最低RT数</label>
                      <input
                        type="number"
                        value={minRetweets}
                        onChange={(e) => setMinRetweets(e.target.value)}
                        placeholder="例: 5"
                        min="0"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                    <div className="flex items-end pb-1">
                      <div className="space-y-2">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={hasMedia}
                            onChange={(e) => setHasMedia(e.target.checked)}
                            className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                          />
                          <span className="text-xs text-gray-600">画像/動画あり</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={hasLinks}
                            onChange={(e) => setHasLinks(e.target.checked)}
                            className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                          />
                          <span className="text-xs text-gray-600">リンクあり</span>
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={searching || !keyword.trim()}
                className="w-full px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors"
              >
                {searching ? '検索中...' : '競合アカウントを検索'}
              </button>
            </form>

            {searchError && <p className="text-sm text-red-500">{searchError}</p>}

            {/* Search results */}
            {candidates.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-gray-600">
                    {candidates.length}件のアカウントが見つかりました
                  </p>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={toggleSelectAll}
                      className="text-xs text-blue-600 hover:text-blue-700"
                    >
                      {selectedIds.size === candidates.length ? 'すべて解除' : 'すべて選択'}
                    </button>
                    <button
                      onClick={handleBulkAdd}
                      disabled={adding || selectedIds.size === 0}
                      className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    >
                      {adding ? '追加中...' : `選択した${selectedIds.size}件を追加`}
                    </button>
                  </div>
                </div>

                <div className="max-h-96 overflow-y-auto space-y-2">
                  {candidates.map(c => (
                    <label
                      key={c.user_id}
                      className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                        selectedIds.has(c.user_id)
                          ? 'border-blue-400 bg-blue-50'
                          : 'border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(c.user_id)}
                        onChange={() => toggleSelect(c.user_id)}
                        className="mt-1 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {c.profile_image_url && (
                            <img
                              src={c.profile_image_url}
                              alt=""
                              className="w-8 h-8 rounded-full flex-shrink-0"
                            />
                          )}
                          <div className="min-w-0">
                            <p className="font-medium text-sm text-gray-900 truncate">
                              {c.name}
                            </p>
                            <p className="text-xs text-gray-500">@{c.handle}</p>
                          </div>
                        </div>
                        {c.description && (
                          <p className="text-xs text-gray-500 mt-1 line-clamp-2">{c.description}</p>
                        )}
                        <div className="flex flex-wrap gap-3 mt-1 text-xs text-gray-400">
                          <span>フォロワー: {formatNumber(c.followers_count)}</span>
                          <span>ツイート数: {formatNumber(c.tweet_count)}</span>
                          <span>検索ヒット: {c.matched_tweets}件</span>
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Competitor list */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-700">
          登録済み ({competitors.length}件)
        </h3>
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

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAPI } from '../hooks/useAPI';
import { useAccount } from '../contexts/AccountContext';
import { formatNumber, formatPercent, formatRelativeTime } from '../utils/formatters';
import ModelSelect from '../components/ModelSelect';

const QUOTE_ANGLES = [
  { id: 'agree', label: '同意+補足', desc: '共感しつつ自分の知見を追加' },
  { id: 'counter', label: '反論', desc: '別の視点を提示' },
  { id: 'question', label: '質問', desc: '議論を促す問いかけ' },
  { id: 'experience', label: '体験談', desc: '自身の経験を交えたコメント' },
  { id: 'data', label: 'データ補足', desc: '数字や事実で補強' },
];

export default function QuoteWorkflow() {
  const navigate = useNavigate();
  const { get, post, loading } = useAPI();
  const { currentAccount } = useAccount();

  // Step management
  const [step, setStep] = useState(1);

  // Step 1: Fetch & suggest
  const [suggestions, setSuggestions] = useState([]);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState('');

  // Step 2: Selected tweet
  const [selectedTweet, setSelectedTweet] = useState(null);

  // Step 3: AI generation
  const [quoteAngle, setQuoteAngle] = useState('agree');
  const [provider, setProvider] = useState('claude');
  const [model, setModel] = useState('claude-sonnet-4-20250514');
  const [candidates, setCandidates] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState('');

  useEffect(() => {
    if (currentAccount) {
      setProvider(currentAccount.default_ai_provider || 'claude');
      setModel(currentAccount.default_ai_model || 'claude-sonnet-4-20250514');
    }
  }, [currentAccount]);

  const handleFetchAndSuggest = async () => {
    setFetching(true);
    setFetchError('');
    setSuggestions([]);
    try {
      // First fetch latest competitor tweets
      await post('/competitors/fetch');
      // Then get suggestions
      const params = currentAccount ? `?accountId=${currentAccount.id}&limit=10` : '?limit=10';
      const data = await get(`/analytics/quote-suggestions${params}`);
      setSuggestions(data || []);
      if (data.length === 0) {
        setFetchError('推薦候補が見つかりませんでした。競合アカウントを追加してツイートを取得してください。');
      }
    } catch (err) {
      setFetchError(err.message);
    } finally {
      setFetching(false);
    }
  };

  const handleSelectTweet = (tweet) => {
    setSelectedTweet(tweet);
    setStep(2);
  };

  const handleGenerate = async () => {
    if (!selectedTweet) return;
    setGenerating(true);
    setGenError('');
    setCandidates([]);
    try {
      const result = await post('/ai/generate', {
        theme: selectedTweet.text,
        postType: 'quote',
        provider,
        model,
        accountId: currentAccount?.id,
        includeCompetitorContext: true,
        targetTweetText: selectedTweet.text,
        targetHandle: selectedTweet.handle,
        quoteAngle,
      });
      setCandidates(result.candidates || []);
      setStep(3);
    } catch (err) {
      setGenError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleSelectCandidate = (candidate) => {
    navigate('/post', {
      state: {
        mode: 'quote',
        targetTweetId: selectedTweet.tweet_id,
        prefillText: candidate.text,
      },
    });
  };

  const handleDirectQuote = () => {
    navigate('/post', {
      state: {
        mode: 'quote',
        targetTweetId: selectedTweet.tweet_id,
      },
    });
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <h2 className="text-xl font-bold text-gray-900">引用RTワークフロー</h2>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-sm">
        {[
          { num: 1, label: '候補取得' },
          { num: 2, label: 'アングル選択' },
          { num: 3, label: 'AI生成・投稿' },
        ].map(({ num, label }) => (
          <React.Fragment key={num}>
            {num > 1 && <span className="text-gray-300">→</span>}
            <button
              onClick={() => num < step && setStep(num)}
              disabled={num > step}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                step === num
                  ? 'bg-blue-600 text-white'
                  : num < step
                  ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                  : 'bg-gray-100 text-gray-400'
              }`}
            >
              {num}. {label}
            </button>
          </React.Fragment>
        ))}
      </div>

      {/* Step 1: Fetch & Suggest */}
      {step === 1 && (
        <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-gray-900">競合ツイート取得 & 候補推薦</h3>
              <p className="text-xs text-gray-500 mt-1">
                競合の最新ツイートを取得し、エンゲージメント率が高い引用RT候補を推薦します
              </p>
            </div>
            <button
              onClick={handleFetchAndSuggest}
              disabled={fetching}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex-shrink-0"
            >
              {fetching ? '取得中...' : '取得 & 推薦'}
            </button>
          </div>

          {fetchError && <p className="text-sm text-red-500">{fetchError}</p>}

          {suggestions.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-gray-700">
                推薦候補 ({suggestions.length}件) - 引用RT済みのツイートは除外済み
              </p>
              {suggestions.map((tweet, i) => (
                <div
                  key={tweet.id}
                  className="border border-gray-100 rounded-lg p-3 hover:border-blue-300 hover:bg-blue-50/30 transition-colors cursor-pointer"
                  onClick={() => handleSelectTweet(tweet)}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-xs font-bold text-gray-400 mt-1">#{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-500 mb-1">
                        @{tweet.handle} &middot; {formatRelativeTime(tweet.created_at_x)}
                      </p>
                      <p className="text-sm text-gray-800 break-words">{tweet.text}</p>
                      <div className="flex flex-wrap gap-3 mt-2 text-xs text-gray-500">
                        <span className="font-medium text-blue-600">ER: {formatPercent(tweet.engagement_rate)}</span>
                        <span>♥ {formatNumber(tweet.like_count)}</span>
                        <span>RT {formatNumber(tweet.retweet_count)}</span>
                        <span>💬 {formatNumber(tweet.reply_count)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Step 2: Angle Selection & Generate */}
      {step === 2 && selectedTweet && (
        <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
          <h3 className="font-semibold text-gray-900">アングル選択 & AI生成</h3>

          {/* Selected tweet preview */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
            <p className="text-xs font-medium text-gray-500 mb-1">引用元ツイート</p>
            <p className="text-xs text-gray-500">@{selectedTweet.handle}</p>
            <p className="text-sm text-gray-800 mt-1">{selectedTweet.text}</p>
            <div className="flex gap-3 mt-2 text-xs text-gray-400">
              <span>ER: {formatPercent(selectedTweet.engagement_rate)}</span>
              <span>♥ {formatNumber(selectedTweet.like_count)}</span>
              <span>RT {formatNumber(selectedTweet.retweet_count)}</span>
            </div>
          </div>

          {/* Angle selector */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">引用アングル</p>
            <div className="grid grid-cols-2 gap-2">
              {QUOTE_ANGLES.map((angle) => (
                <button
                  key={angle.id}
                  onClick={() => setQuoteAngle(angle.id)}
                  className={`text-left p-3 rounded-lg border-2 transition-colors ${
                    quoteAngle === angle.id
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <p className="text-sm font-medium text-gray-900">{angle.label}</p>
                  <p className="text-xs text-gray-500">{angle.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Model selection */}
          <ModelSelect
            provider={provider}
            model={model}
            onProviderChange={setProvider}
            onModelChange={setModel}
          />

          {genError && <p className="text-sm text-red-500">{genError}</p>}

          <div className="flex gap-2">
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors"
            >
              {generating ? 'AI生成中...' : 'AI生成する'}
            </button>
            <button
              onClick={handleDirectQuote}
              className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              手動で書く
            </button>
            <button
              onClick={() => setStep(1)}
              className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              戻る
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Candidates & Post */}
      {step === 3 && selectedTweet && candidates.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
          <h3 className="font-semibold text-gray-900">AI生成結果</h3>

          {/* Selected tweet reminder */}
          <div className="bg-gray-50 rounded-lg p-2 text-xs text-gray-500">
            引用元: @{selectedTweet.handle} 「{selectedTweet.text}」
          </div>

          <p className="text-sm text-gray-700">候補を選択して投稿画面に進みます:</p>

          <div className="space-y-2">
            {candidates.map((c, i) => (
              <button
                key={i}
                onClick={() => handleSelectCandidate(c)}
                className="w-full text-left p-3 border border-gray-200 rounded-lg hover:border-purple-300 hover:bg-purple-50 transition-colors"
              >
                <p className="text-xs font-medium text-gray-400 mb-1">候補 {i + 1}</p>
                <p className="text-sm text-gray-800">{c.text}</p>
                {c.hashtags.length > 0 && (
                  <p className="text-xs text-purple-500 mt-1">{c.hashtags.join(' ')}</p>
                )}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setStep(2)}
              className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              アングルを変えて再生成
            </button>
            <button
              onClick={handleDirectQuote}
              className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              手動で書く
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

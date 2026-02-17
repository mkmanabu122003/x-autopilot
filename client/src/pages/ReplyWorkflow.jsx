import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAPI } from '../hooks/useAPI';
import { useAccount } from '../contexts/AccountContext';
import { formatNumber, formatPercent, formatRelativeTime } from '../utils/formatters';
import ModelSelect from '../components/ModelSelect';

const REPLY_ANGLES = [
  { id: 'empathy', label: '共感+実体験', desc: '共感しつつ自分の体験を添える' },
  { id: 'info', label: '補足情報', desc: '有益な情報や具体例を提供' },
  { id: 'question', label: '質問', desc: '会話を広げる問いかけ' },
  { id: 'episode', label: 'エピソード共有', desc: '関連する自分のエピソード' },
  { id: 'support', label: '応援・共鳴', desc: '相手の取り組みに共鳴' },
  { id: 'perspective', label: '別視点提示', desc: '別の角度からの視点' },
];

export default function ReplyWorkflow() {
  const navigate = useNavigate();
  const { get, post, put, loading } = useAPI();
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
  const [replyAngle, setReplyAngle] = useState('empathy');
  const [provider, setProvider] = useState('claude');
  const [model, setModel] = useState('claude-sonnet-4-20250514');
  const [candidates, setCandidates] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState('');

  // Prompt editor
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [promptData, setPromptData] = useState(null);
  const [promptSaved, setPromptSaved] = useState(false);

  useEffect(() => {
    if (currentAccount) {
      setProvider(currentAccount.default_ai_provider || 'claude');
      setModel(currentAccount.default_ai_model || 'claude-sonnet-4-20250514');
    }
  }, [currentAccount]);

  // Load prompt when editor is opened
  useEffect(() => {
    if (showPromptEditor && !promptData) {
      get('/settings/prompts/reply_generation').then(setPromptData).catch(() => {});
    }
  }, [showPromptEditor, promptData, get]);

  const handleSavePrompt = async () => {
    if (!promptData) return;
    try {
      await put('/settings/prompts/reply_generation', {
        system_prompt: promptData.system_prompt,
        user_template: promptData.user_template
      });
      setPromptSaved(true);
      setTimeout(() => setPromptSaved(false), 2000);
    } catch (err) {
      setGenError('プロンプト保存に失敗しました: ' + err.message);
    }
  };

  const handleResetPrompt = async () => {
    try {
      const result = await post('/settings/prompts/reply_generation/reset');
      setPromptData({
        task_type: 'reply_generation',
        system_prompt: result.system_prompt,
        user_template: result.user_template,
        is_custom: false
      });
    } catch (err) {
      setGenError('プロンプトリセットに失敗しました: ' + err.message);
    }
  };

  const handleFetchAndSuggest = async () => {
    setFetching(true);
    setFetchError('');
    setSuggestions([]);
    try {
      // First fetch latest competitor tweets
      await post('/competitors/fetch');
      // Then get suggestions
      const params = currentAccount ? `?accountId=${currentAccount.id}&limit=10` : '?limit=10';
      const data = await get(`/analytics/reply-suggestions${params}`);
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
        postType: 'reply',
        provider,
        model,
        accountId: currentAccount?.id,
        includeCompetitorContext: true,
        targetTweetText: selectedTweet.text,
        targetHandle: selectedTweet.handle,
        replyAngle,
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
        mode: 'reply',
        targetTweetId: selectedTweet.tweet_id,
        prefillText: candidate.text,
      },
    });
  };

  const handleDirectReply = () => {
    navigate('/post', {
      state: {
        mode: 'reply',
        targetTweetId: selectedTweet.tweet_id,
      },
    });
  };

  const isLoading = fetching || generating;

  return (
    <div className="space-y-6 max-w-2xl relative">
      {/* Full-page loading overlay */}
      {isLoading && (
        <div className="fixed inset-0 bg-white/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-4 border-green-200 border-t-green-600 rounded-full animate-spin" />
            <p className="text-sm font-medium text-gray-700">
              {fetching ? '競合ツイートを取得中...' : 'AI生成中...'}
            </p>
          </div>
        </div>
      )}

      <h2 className="text-xl font-bold text-gray-900">リプライワークフロー</h2>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-sm">
        {[
          { num: 1, label: '候補取得' },
          { num: 2, label: 'アングル選択' },
          { num: 3, label: 'AI生成・投稿' },
        ].map(({ num, label }) => (
          <React.Fragment key={num}>
            {num > 1 && <span className="text-gray-300">&rarr;</span>}
            <button
              onClick={() => num < step && setStep(num)}
              disabled={num > step}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                step === num
                  ? 'bg-green-600 text-white'
                  : num < step
                  ? 'bg-green-100 text-green-700 hover:bg-green-200'
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
              <h3 className="font-semibold text-gray-900">競合ツイート取得 & リプライ候補推薦</h3>
              <p className="text-xs text-gray-500 mt-1">
                競合の最新ツイートを取得し、エンゲージメント率が高いリプライ候補を推薦します
              </p>
            </div>
            <button
              onClick={handleFetchAndSuggest}
              disabled={fetching}
              className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors flex-shrink-0"
            >
              {fetching ? '取得中...' : '取得 & 推薦'}
            </button>
          </div>

          {fetchError && <p className="text-sm text-red-500">{fetchError}</p>}

          {suggestions.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-gray-700">
                推薦候補 ({suggestions.length}件) - リプライ済みのツイートは除外済み
              </p>
              {suggestions.map((tweet, i) => (
                <div
                  key={tweet.id}
                  className="border border-gray-100 rounded-lg p-3 hover:border-green-300 hover:bg-green-50/30 transition-colors cursor-pointer"
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
                        <span className="font-medium text-green-600">ER: {formatPercent(tweet.engagement_rate)}</span>
                        <span>&#9829; {formatNumber(tweet.like_count)}</span>
                        <span>RT {formatNumber(tweet.retweet_count)}</span>
                        <span>&#128172; {formatNumber(tweet.reply_count)}</span>
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
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-medium text-gray-500">リプライ先ツイート</span>
              <span className="text-xs text-gray-400">@{selectedTweet.handle}</span>
            </div>
            <p className="text-sm text-gray-800 whitespace-pre-wrap break-words leading-relaxed">{selectedTweet.text}</p>
            <div className="flex gap-3 mt-2 text-xs text-gray-400">
              <span>ER: {formatPercent(selectedTweet.engagement_rate)}</span>
              <span>&#9829; {formatNumber(selectedTweet.like_count)}</span>
              <span>RT {formatNumber(selectedTweet.retweet_count)}</span>
            </div>
          </div>

          {/* Angle selector */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">リプライアングル</p>
            <div className="grid grid-cols-2 gap-2">
              {REPLY_ANGLES.map((angle) => (
                <button
                  key={angle.id}
                  onClick={() => setReplyAngle(angle.id)}
                  className={`text-left p-3 rounded-lg border-2 transition-colors ${
                    replyAngle === angle.id
                      ? 'border-green-500 bg-green-50'
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

          {/* Prompt editor toggle */}
          <div className="border-t border-gray-100 pt-3">
            <button
              onClick={() => setShowPromptEditor(!showPromptEditor)}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors flex items-center gap-1"
            >
              <span>{showPromptEditor ? '▼' : '▶'}</span>
              プロンプト編集
              {promptData?.is_custom && <span className="text-green-500">(カスタム)</span>}
            </button>

            {showPromptEditor && promptData && (
              <div className="mt-3 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    システムプロンプト
                  </label>
                  <textarea
                    value={promptData.system_prompt || ''}
                    onChange={(e) => setPromptData(prev => ({ ...prev, system_prompt: e.target.value }))}
                    rows={20}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs resize-y font-mono min-h-[200px] max-h-[70vh]"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSavePrompt}
                    className="px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 transition-colors"
                  >
                    保存
                  </button>
                  <button
                    onClick={handleResetPrompt}
                    className="px-3 py-1.5 text-xs text-gray-500 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    デフォルトに戻す
                  </button>
                  {promptSaved && <span className="text-xs text-green-600">保存しました</span>}
                </div>
              </div>
            )}
          </div>

          {genError && <p className="text-sm text-red-500">{genError}</p>}

          <div className="flex gap-2">
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {generating ? 'AI生成中...' : 'AI生成する'}
            </button>
            <button
              onClick={handleDirectReply}
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
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-medium text-gray-500">リプライ先ツイート</span>
              <span className="text-xs text-gray-400">@{selectedTweet.handle}</span>
            </div>
            <p className="text-sm text-gray-700 whitespace-pre-wrap break-words">{selectedTweet.text}</p>
          </div>

          <p className="text-sm text-gray-700">候補を選択して投稿画面に進みます:</p>

          <div className="space-y-2">
            {candidates.map((c, i) => (
              <button
                key={i}
                onClick={() => handleSelectCandidate(c)}
                className="w-full text-left p-3 border border-gray-200 rounded-lg hover:border-green-300 hover:bg-green-50 transition-colors"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium text-gray-400">候補 {i + 1}</span>
                  {c.label && <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">{c.label}</span>}
                  <span className="text-xs text-gray-300 ml-auto">{c.text.length}文字</span>
                </div>
                <p className="text-sm text-gray-800 whitespace-pre-wrap">{c.text}</p>
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
              onClick={handleDirectReply}
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

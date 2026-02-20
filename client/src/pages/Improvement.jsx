import React, { useState, useEffect, useCallback } from 'react';
import { useAPI } from '../hooks/useAPI';
import { useAccount } from '../contexts/AccountContext';
import { formatPercent, formatNumber, formatRelativeTime } from '../utils/formatters';
import StatsCard from '../components/StatsCard';

const PRIORITY_STYLES = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-yellow-100 text-yellow-700',
  low: 'bg-blue-100 text-blue-700',
};

const CATEGORY_LABELS = {
  content: 'コンテンツ',
  timing: '投稿時間',
  style: 'スタイル',
  theme: 'テーマ',
};

export default function Improvement() {
  const [activeTab, setActiveTab] = useState('analysis');
  const [performance, setPerformance] = useState(null);
  const [latestAnalysis, setLatestAnalysis] = useState(null);
  const [history, setHistory] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [adjustResult, setAdjustResult] = useState(null);
  const [analysisResult, setAnalysisResult] = useState(null);
  const { get, post } = useAPI();
  const { currentAccount } = useAccount();

  const loadData = useCallback(async () => {
    if (!currentAccount) return;
    const params = `?accountId=${currentAccount.id}`;
    try {
      const [perf, latest, hist] = await Promise.all([
        get(`/improvement/performance${params}`).catch(() => null),
        get(`/improvement/analysis${params}`).catch(() => null),
        get(`/improvement/history${params}`).catch(() => []),
      ]);
      setPerformance(perf);
      setLatestAnalysis(latest);
      setHistory(Array.isArray(hist) ? hist : []);
    } catch {
      // ignore
    }
  }, [get, currentAccount]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleAnalyze = async () => {
    if (!currentAccount) return;
    if (!window.confirm('AI改善分析を実行します。APIコストが発生しますが、よろしいですか？')) return;
    setAnalyzing(true);
    setAnalysisResult(null);
    try {
      const result = await post('/improvement/analyze', {
        accountId: currentAccount.id,
      });
      setAnalysisResult(result);
      await loadData();
    } catch (e) {
      alert(`分析エラー: ${e.message}`);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleAutoAdjust = async () => {
    if (!currentAccount) return;
    if (!window.confirm('パフォーマンスデータに基づいて、投稿時間・スタイル設定を自動調整します。よろしいですか？')) return;
    setAdjusting(true);
    setAdjustResult(null);
    try {
      const result = await post('/improvement/auto-adjust', {
        accountId: currentAccount.id,
      });
      setAdjustResult(result);
    } catch (e) {
      alert(`調整エラー: ${e.message}`);
    } finally {
      setAdjusting(false);
    }
  };

  if (!currentAccount) {
    return (
      <div className="text-center py-12 text-gray-400">
        アカウントを選択してください
      </div>
    );
  }

  const tabs = [
    { id: 'analysis', label: 'パフォーマンス分析' },
    { id: 'suggestions', label: '改善提案' },
    { id: 'history', label: '分析履歴' },
  ];

  return (
    <div className="space-y-6 max-w-3xl relative">
      {/* Loading overlay */}
      {analyzing && (
        <div className="fixed inset-0 bg-white/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
            <p className="text-sm font-medium text-gray-700">AI改善分析を実行中...</p>
          </div>
        </div>
      )}

      <div>
        <h2 className="text-xl font-bold text-gray-900">ツイート改善</h2>
        <p className="text-sm text-gray-500 mt-1">
          投稿のエンゲージメントデータを分析し、AIが改善提案を生成します
        </p>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={handleAnalyze}
          disabled={analyzing}
          className="px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {analyzing ? '分析中...' : 'AI改善分析を実行'}
        </button>
        <button
          onClick={handleAutoAdjust}
          disabled={adjusting}
          className="px-4 py-2.5 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          {adjusting ? '調整中...' : '設定を自動調整'}
        </button>
      </div>

      {/* Auto-adjust result notification */}
      {adjustResult && (
        <div className={`border rounded-lg p-4 ${adjustResult.adjusted ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
          {adjustResult.adjusted ? (
            <>
              <p className="text-sm font-medium text-green-800 mb-2">設定を自動調整しました</p>
              {adjustResult.adjustments.map((adj, i) => (
                <div key={i} className="text-xs text-green-700 mb-1">
                  <span className="font-medium">{adj.type === 'schedule_times' ? '投稿時間' : 'スタイル'}:</span>{' '}
                  {adj.reason}
                </div>
              ))}
            </>
          ) : (
            <p className="text-sm text-gray-600">
              {adjustResult.reason || '現在の設定は最適です。調整の必要はありません。'}
            </p>
          )}
        </div>
      )}

      {/* Analysis result notification */}
      {analysisResult && analysisResult.status === 'insufficient_data' && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <p className="text-sm text-yellow-800">{analysisResult.message}</p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
              activeTab === tab.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'analysis' && (
        <PerformanceTab performance={performance} />
      )}
      {activeTab === 'suggestions' && (
        <SuggestionsTab
          latestAnalysis={latestAnalysis}
          analysisResult={analysisResult}
        />
      )}
      {activeTab === 'history' && (
        <HistoryTab history={history} />
      )}
    </div>
  );
}

function PerformanceTab({ performance }) {
  if (!performance || performance.status === 'insufficient_data') {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6 text-center text-gray-400">
        <p>{performance?.message || 'パフォーマンスデータがまだありません'}</p>
        <p className="text-xs mt-1">エンゲージメント指標付きの投稿が5件以上必要です</p>
      </div>
    );
  }

  const { overallStats, categoryAnalysis, timeAnalysis, textAnalysis, topPosts, bottomPosts } = performance;

  return (
    <div className="space-y-4">
      {/* Overall KPIs */}
      <div className="grid grid-cols-3 gap-3">
        <StatsCard title="平均ER" value={formatPercent(overallStats.avgEngagementRate)} />
        <StatsCard title="平均インプレッション" value={formatNumber(overallStats.avgImpressions)} />
        <StatsCard title="平均いいね" value={overallStats.avgLikes.toFixed(1)} />
      </div>

      {/* Top performing posts */}
      {topPosts.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="font-semibold text-gray-900 text-sm mb-3">高パフォーマンス投稿 (上位25%)</h3>
          <div className="space-y-2">
            {topPosts.map((post, i) => (
              <div key={i} className="flex items-start gap-3 text-xs border-b border-gray-100 pb-2 last:border-0 last:pb-0">
                <span className="flex-shrink-0 bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-medium">
                  ER {post.engagementRate?.toFixed(1)}%
                </span>
                <span className="text-gray-700 line-clamp-2">{post.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bottom performing posts */}
      {bottomPosts.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="font-semibold text-gray-900 text-sm mb-3">低パフォーマンス投稿 (下位25%)</h3>
          <div className="space-y-2">
            {bottomPosts.map((post, i) => (
              <div key={i} className="flex items-start gap-3 text-xs border-b border-gray-100 pb-2 last:border-0 last:pb-0">
                <span className="flex-shrink-0 bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-medium">
                  ER {post.engagementRate?.toFixed(1)}%
                </span>
                <span className="text-gray-700 line-clamp-2">{post.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Category performance */}
      {categoryAnalysis && categoryAnalysis.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="font-semibold text-gray-900 text-sm mb-3">テーマカテゴリ別パフォーマンス</h3>
          <div className="space-y-2">
            {categoryAnalysis.map((cat, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="text-gray-700">{cat.category}</span>
                <div className="flex items-center gap-3">
                  <span className="text-gray-500">{cat.postCount}件</span>
                  <span className={`font-medium ${i === 0 ? 'text-green-700' : i === categoryAnalysis.length - 1 ? 'text-red-600' : 'text-gray-900'}`}>
                    ER {cat.avgEngagementRate.toFixed(1)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Time analysis */}
      {timeAnalysis && timeAnalysis.hourlyPerformance && timeAnalysis.hourlyPerformance.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="font-semibold text-gray-900 text-sm mb-3">時間帯別パフォーマンス (JST)</h3>
          <div className="space-y-2">
            {timeAnalysis.hourlyPerformance.map((h, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="text-gray-700">{h.hour}:00</span>
                <div className="flex items-center gap-3">
                  <span className="text-gray-500">{h.postCount}件</span>
                  <span className={`font-medium ${i === 0 ? 'text-green-700' : 'text-gray-900'}`}>
                    ER {h.avgEngagementRate.toFixed(1)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
          {timeAnalysis.bestHours && timeAnalysis.bestHours.length > 0 && (
            <p className="text-xs text-green-700 mt-2">
              推奨投稿時間: {timeAnalysis.bestHours.map(h => `${h}:00`).join(', ')}
            </p>
          )}
        </div>
      )}

      {/* Text feature analysis */}
      {textAnalysis && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="font-semibold text-gray-900 text-sm mb-3">テキスト特徴分析</h3>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <FeatureCompare label="文字数" top={`${textAnalysis.avgLength.top}字`} bottom={`${textAnalysis.avgLength.bottom}字`} />
            <FeatureCompare label="問いかけ" top={`${textAnalysis.hasQuestion.topRate}%`} bottom={`${textAnalysis.hasQuestion.bottomRate}%`} />
            <FeatureCompare label="引用（「」）" top={`${textAnalysis.hasQuotes.topRate}%`} bottom={`${textAnalysis.hasQuotes.bottomRate}%`} />
            <FeatureCompare label="数字" top={`${textAnalysis.hasNumbers.topRate}%`} bottom={`${textAnalysis.hasNumbers.bottomRate}%`} />
            <FeatureCompare label="改行数" top={textAnalysis.avgLineBreaks.top.toFixed(1)} bottom={textAnalysis.avgLineBreaks.bottom.toFixed(1)} />
          </div>
        </div>
      )}
    </div>
  );
}

function FeatureCompare({ label, top, bottom }) {
  return (
    <div className="flex items-center justify-between bg-gray-50 rounded px-3 py-2">
      <span className="text-gray-600">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-green-700 font-medium">{top}</span>
        <span className="text-gray-400">/</span>
        <span className="text-red-600 font-medium">{bottom}</span>
      </div>
    </div>
  );
}

function SuggestionsTab({ latestAnalysis, analysisResult }) {
  // Prefer fresh analysis result, fall back to saved latest
  const suggestions = analysisResult?.suggestions || latestAnalysis?.suggestions || [];
  const createdAt = latestAnalysis?.created_at;

  if (!suggestions || suggestions.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6 text-center text-gray-400">
        <p>改善提案がまだありません</p>
        <p className="text-xs mt-1">「AI改善分析を実行」ボタンで分析を開始してください</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {createdAt && (
        <p className="text-xs text-gray-400">最終分析: {formatRelativeTime(createdAt)}</p>
      )}
      {suggestions.map((s, i) => (
        <div key={i} className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${PRIORITY_STYLES[s.priority] || PRIORITY_STYLES.medium}`}>
              {s.priority === 'high' ? '重要' : s.priority === 'low' ? '参考' : '推奨'}
            </span>
            <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
              {CATEGORY_LABELS[s.category] || s.category}
            </span>
          </div>
          <h4 className="font-semibold text-gray-900 text-sm">{s.title}</h4>
          <p className="text-xs text-gray-600 mt-1">{s.description}</p>
          {s.action && (
            <div className="mt-2 bg-blue-50 border border-blue-100 rounded px-3 py-2">
              <p className="text-xs text-blue-800">
                <span className="font-medium">アクション:</span> {s.action}
              </p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function HistoryTab({ history }) {
  if (!history || history.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6 text-center text-gray-400">
        <p>分析履歴がまだありません</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {history.map((item) => (
        <div key={item.id} className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-400">{formatRelativeTime(item.created_at)}</span>
            <span className="text-xs text-gray-500">{item.post_count}件分析</span>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-gray-700">
              平均ER: <span className="font-semibold">{item.avg_engagement_rate?.toFixed(1)}%</span>
            </span>
            <span className="text-gray-700">
              平均imp: <span className="font-semibold">{formatNumber(item.avg_impressions || 0)}</span>
            </span>
          </div>
          {item.suggestions && item.suggestions.length > 0 && (
            <div className="mt-2 text-xs text-gray-500">
              提案: {item.suggestions.length}件
              ({item.suggestions.filter(s => s.priority === 'high').length}件重要)
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

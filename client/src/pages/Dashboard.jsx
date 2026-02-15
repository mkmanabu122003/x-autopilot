import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAPI } from '../hooks/useAPI';
import { useAccount } from '../contexts/AccountContext';
import { formatNumber, formatCurrency, formatPercent } from '../utils/formatters';
import StatsCard from '../components/StatsCard';
import EngagementChart from '../components/EngagementChart';
import HourlyChart from '../components/HourlyChart';
import PostTypeChart from '../components/PostTypeChart';
import TopPosts from '../components/TopPosts';

export default function Dashboard() {
  const [summary, setSummary] = useState(null);
  const { get } = useAPI();
  const { currentAccount } = useAccount();
  const navigate = useNavigate();

  useEffect(() => {
    const params = currentAccount ? `?accountId=${currentAccount.id}` : '';
    get(`/analytics/dashboard${params}`).then(setSummary).catch(() => {});
  }, [get, currentAccount]);

  const handleQuote = (post) => {
    navigate('/post', { state: { mode: 'quote', targetTweetId: post.tweet_id } });
  };

  const handleReply = (post) => {
    navigate('/post', { state: { mode: 'reply', targetTweetId: post.tweet_id } });
  };

  const budgetWarning = summary && summary.apiCostUsd > summary.budgetUsd * 0.8;

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-gray-900">ダッシュボード</h2>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatsCard
          title="今月の投稿数"
          value={summary ? summary.myPostCount : '-'}
        />
        <StatsCard
          title="平均エンゲージメント率"
          value={summary ? formatPercent(summary.avgEngagementRate) : '-'}
        />
        <StatsCard
          title="API利用額"
          value={summary ? formatCurrency(summary.apiCostUsd) : '-'}
          subtitle={summary ? `予算: ${formatCurrency(summary.budgetUsd)}` : ''}
          warning={budgetWarning}
        />
        <StatsCard
          title="総インプレッション"
          value={summary ? formatNumber(summary.totalImpressions) : '-'}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <EngagementChart />
        <HourlyChart />
      </div>

      <PostTypeChart />

      {/* Top posts ranking */}
      <TopPosts onQuote={handleQuote} onReply={handleReply} />
    </div>
  );
}

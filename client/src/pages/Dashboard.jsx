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
import CostSummaryCard from '../components/CostSummaryCard';
import CostDashboard from '../components/CostDashboard';
import BudgetAlert from '../components/BudgetAlert';

export default function Dashboard() {
  const [summary, setSummary] = useState(null);
  const [showCostDetail, setShowCostDetail] = useState(false);
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

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-gray-900">ダッシュボード</h2>

      {/* Budget Alert */}
      <BudgetAlert />

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
        <CostSummaryCard onDetailClick={() => setShowCostDetail(true)} />
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

      {/* Cost Detail Modal */}
      {showCostDetail && (
        <CostDashboard onClose={() => setShowCostDetail(false)} />
      )}
    </div>
  );
}

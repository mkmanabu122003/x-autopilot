import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAPI } from '../hooks/useAPI';
import { useAccount } from '../contexts/AccountContext';
import { formatNumber, formatCurrency, formatPercent } from '../utils/formatters';
import StatsCard from '../components/StatsCard';
import FollowerGrowthChart from '../components/FollowerGrowthChart';
import OwnWeeklyChart from '../components/OwnWeeklyChart';
import OwnPostsTable from '../components/OwnPostsTable';
import GrowthFunnel from '../components/GrowthFunnel';
import HourlyChart from '../components/HourlyChart';
import PostTypeChart from '../components/PostTypeChart';
import EngagementChart from '../components/EngagementChart';
import TopPosts from '../components/TopPosts';
import CostSummaryCard from '../components/CostSummaryCard';
import CostDashboard from '../components/CostDashboard';
import BudgetAlert from '../components/BudgetAlert';

export default function Dashboard() {
  const [growth, setGrowth] = useState(null);
  const [showCostDetail, setShowCostDetail] = useState(false);
  const [showCompetitor, setShowCompetitor] = useState(false);
  const { get } = useAPI();
  const { currentAccount } = useAccount();
  const navigate = useNavigate();

  useEffect(() => {
    const params = currentAccount ? `?accountId=${currentAccount.id}` : '';
    get(`/growth/dashboard${params}`).then(setGrowth).catch(() => {});
  }, [get, currentAccount]);

  const handleQuote = (post) => {
    navigate('/post', { state: { mode: 'quote', targetTweetId: post.tweet_id } });
  };

  const handleReply = (post) => {
    navigate('/post', { state: { mode: 'reply', targetTweetId: post.tweet_id } });
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-gray-900">Growth Dashboard</h2>

      {/* Budget Alert */}
      <BudgetAlert />

      {/* === Section 1: Growth KPIs === */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatsCard
          title="フォロワー"
          value={growth ? formatNumber(growth.currentFollowers) : '-'}
          subtitle={growth && growth.followerGrowth30d !== 0
            ? `${growth.followerGrowth30d >= 0 ? '+' : ''}${growth.followerGrowth30d} (30日)`
            : undefined}
          warning={growth && growth.followerGrowth30d < 0}
        />
        <StatsCard
          title="自分の平均ER"
          value={growth ? formatPercent(growth.thisMonthAvgER) : '-'}
          subtitle={growth && growth.erChange !== 0
            ? `前月比 ${growth.erChange >= 0 ? '+' : ''}${growth.erChange.toFixed(1)}%`
            : undefined}
          warning={growth && growth.erChange < 0}
        />
        <StatsCard
          title="今月のインプレッション"
          value={growth ? formatNumber(growth.thisMonthImpressions) : '-'}
          subtitle={growth && growth.impressionChange !== 0
            ? `前月比 ${growth.impressionChange >= 0 ? '+' : ''}${formatNumber(growth.impressionChange)}`
            : undefined}
          warning={growth && growth.impressionChange < 0}
        />
        <StatsCard
          title="今月の投稿数"
          value={growth ? growth.thisMonthPostCount : '-'}
          subtitle={growth ? `${growth.thisMonthEngagements} エンゲージメント` : undefined}
        />
      </div>

      {/* === Section 2: Follower Growth & Funnel === */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <FollowerGrowthChart />
        </div>
        <GrowthFunnel data={growth} />
      </div>

      {/* === Section 3: Own Post Performance === */}
      <OwnWeeklyChart />

      {/* === Section 4: Content Strategy (Competitor data) === */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <HourlyChart />
        <PostTypeChart />
      </div>

      {/* === Section 5: Own Posts Detail === */}
      <OwnPostsTable />

      {/* === Section 6: Competitor Insights (Collapsible) === */}
      <div className="bg-white rounded-lg border border-gray-200">
        <button
          onClick={() => setShowCompetitor(!showCompetitor)}
          className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50 transition-colors rounded-lg"
        >
          <h3 className="font-semibold text-gray-900">競合分析・参考ポスト</h3>
          <svg
            className={`w-5 h-5 text-gray-400 transition-transform ${showCompetitor ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {showCompetitor && (
          <div className="px-4 pb-4 space-y-4">
            <EngagementChart />
            <TopPosts onQuote={handleQuote} onReply={handleReply} />
          </div>
        )}
      </div>

      {/* === Section 7: Cost (Small, at bottom) === */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <CostSummaryCard onDetailClick={() => setShowCostDetail(true)} />
      </div>

      {/* Cost Detail Modal */}
      {showCostDetail && (
        <CostDashboard onClose={() => setShowCostDetail(false)} />
      )}
    </div>
  );
}

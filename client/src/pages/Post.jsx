import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';
import TweetComposer from '../components/TweetComposer';
import ScheduleList from '../components/ScheduleList';
import DraftList from '../components/DraftList';

const tabs = [
  { id: 'new', label: '新規投稿' },
  { id: 'reply', label: 'リプ' },
  { id: 'draft', label: '下書き' }
];

export default function Post() {
  const location = useLocation();
  const initialMode = location.state?.mode || 'new';
  const initialTarget = location.state?.targetTweetId || '';
  const initialText = location.state?.prefillText || '';

  const [activeTab, setActiveTab] = useState(initialMode);
  const [postKey, setPostKey] = useState(0);

  const handlePosted = () => {
    setPostKey(k => k + 1);
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-gray-900">投稿</h2>

      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Composer */}
      <TweetComposer
        key={`${activeTab}-${postKey}`}
        mode={activeTab}
        targetTweetId={activeTab === initialMode ? initialTarget : ''}
        initialText={activeTab === initialMode ? initialText : ''}
        onPosted={handlePosted}
      />

      {/* Drafts */}
      <DraftList key={`draft-${postKey}`} />

      {/* Scheduled posts */}
      <ScheduleList key={`schedule-${postKey}`} />
    </div>
  );
}

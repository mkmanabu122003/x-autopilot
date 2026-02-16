import React, { useState, useEffect, useCallback } from 'react';
import { useAPI } from '../hooks/useAPI';
import { formatDate } from '../utils/formatters';

export default function BatchStatus() {
  const [history, setHistory] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const { get } = useAPI();

  const fetchHistory = useCallback(() => {
    get('/batch/history?limit=10').then(setHistory).catch(() => {});
  }, [get]);

  useEffect(() => {
    fetchHistory();
    const interval = setInterval(fetchHistory, 30000); // Poll every 30 seconds
    return () => clearInterval(interval);
  }, [fetchHistory]);

  if (history.length === 0) return null;

  const statusBadge = (status) => {
    const styles = {
      processing: 'bg-yellow-100 text-yellow-800',
      completed: 'bg-green-100 text-green-800',
      failed: 'bg-red-100 text-red-800'
    };
    const labels = {
      processing: '処理中...',
      completed: '完了',
      failed: '失敗'
    };
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${styles[status] || 'bg-gray-100 text-gray-800'}`}>
        {labels[status] || status}
      </span>
    );
  };

  const TASK_LABELS = {
    competitor_analysis: '競合分析',
    tweet_generation: 'ツイート生成',
    comment_generation: 'コメント生成',
    quote_rt_generation: '引用RT生成',
    performance_summary: 'パフォーマンス要約'
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <h3 className="font-semibold text-gray-900 mb-3">バッチ処理履歴</h3>
      <div className="space-y-2">
        {history.map(job => (
          <div key={job.batch_id} className="border border-gray-100 rounded-lg p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {statusBadge(job.status)}
                <span className="text-sm text-gray-700">
                  {TASK_LABELS[job.task_type] || job.task_type}
                </span>
                <span className="text-xs text-gray-400">
                  {job.request_count}件
                  {job.completed_count > 0 && ` / ${job.completed_count}件完了`}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">
                  {formatDate(job.created_at)}
                </span>
                {job.status === 'completed' && job.results && (
                  <button
                    onClick={() => setExpanded(expanded === job.batch_id ? null : job.batch_id)}
                    className="text-xs text-blue-600 hover:text-blue-800"
                  >
                    {expanded === job.batch_id ? '閉じる' : '結果を表示'}
                  </button>
                )}
              </div>
            </div>
            {expanded === job.batch_id && job.results && (
              <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">
                {(Array.isArray(job.results) ? job.results : []).map((draft, i) => (
                  <div key={i} className="bg-gray-50 rounded p-2">
                    <p className="text-sm text-gray-700">{draft.text}</p>
                  </div>
                ))}
                {(!Array.isArray(job.results) || job.results.length === 0) && (
                  <p className="text-sm text-gray-400">結果がありません</p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

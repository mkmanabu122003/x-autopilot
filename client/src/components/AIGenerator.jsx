import React, { useState, useEffect } from 'react';
import { useAPI } from '../hooks/useAPI';
import { useAccount } from '../contexts/AccountContext';
import ModelSelect from './ModelSelect';

export default function AIGenerator({ postType = 'new', onSelect, onClose }) {
  const [theme, setTheme] = useState('');
  const [provider, setProvider] = useState('claude');
  const [model, setModel] = useState('claude-sonnet-4-20250514');
  const [includeContext, setIncludeContext] = useState(false);
  const [candidates, setCandidates] = useState([]);
  const [resultInfo, setResultInfo] = useState(null);
  const { post, loading, error } = useAPI();
  const { currentAccount } = useAccount();

  // Initialize from account defaults
  useEffect(() => {
    if (currentAccount) {
      setProvider(currentAccount.default_ai_provider || 'claude');
      setModel(currentAccount.default_ai_model || 'claude-sonnet-4-20250514');
    }
  }, [currentAccount]);

  const handleGenerate = async () => {
    if (!theme.trim()) return;
    try {
      const result = await post('/ai/generate', {
        theme,
        postType,
        provider,
        model,
        accountId: currentAccount?.id,
        includeCompetitorContext: includeContext
      });
      setCandidates(result.candidates || []);
      setResultInfo({ provider: result.provider, model: result.model });
    } catch (err) {
      // error available via hook
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl w-full max-w-lg max-h-[80vh] overflow-y-auto">
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">AI ツイート生成</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">テーマ / キーワード</label>
            <input
              type="text"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              placeholder="例: 浅草の朝散歩"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
          </div>

          <ModelSelect
            provider={provider}
            model={model}
            onProviderChange={setProvider}
            onModelChange={setModel}
          />

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={includeContext}
              onChange={(e) => setIncludeContext(e.target.checked)}
              className="rounded border-gray-300"
            />
            競合データをプロンプトに含める
          </label>

          <button
            onClick={handleGenerate}
            disabled={loading || !theme.trim()}
            className="w-full py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors"
          >
            {loading ? '生成中...' : '生成する'}
          </button>

          {error && <p className="text-sm text-red-500">{error}</p>}

          {resultInfo && (
            <p className="text-xs text-gray-400">
              {resultInfo.provider} / {resultInfo.model}
            </p>
          )}

          {candidates.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-700">候補を選択:</p>
              {candidates.map((c, i) => (
                <button
                  key={i}
                  onClick={() => onSelect(c)}
                  className="w-full text-left p-3 border border-gray-200 rounded-lg hover:border-purple-300 hover:bg-purple-50 transition-colors"
                >
                  <p className="text-sm text-gray-800">{c.text}</p>
                  {c.hashtags.length > 0 && (
                    <p className="text-xs text-purple-500 mt-1">{c.hashtags.join(' ')}</p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

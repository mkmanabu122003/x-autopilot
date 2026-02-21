import React, { useState, useEffect } from 'react';
import { useAPI } from '../hooks/useAPI';
import { useAccount } from '../contexts/AccountContext';

export default function FeedbackRuleModal({ feedbackHistory, onClose, onSaved }) {
  const [rules, setRules] = useState([]);
  const [selected, setSelected] = useState({});
  const [decomposing, setDecomposing] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const { post } = useAPI();
  const { currentAccount } = useAccount();

  useEffect(() => {
    decomposeFeedback();
  }, []);

  const decomposeFeedback = async () => {
    setDecomposing(true);
    setError(null);
    try {
      const result = await post('/ai/decompose-feedback', {
        feedbackHistory,
        accountId: currentAccount?.id
      });
      const decomposed = result.rules || [];
      setRules(decomposed);
      const initial = {};
      decomposed.forEach((_, i) => { initial[i] = true; });
      setSelected(initial);
    } catch (err) {
      setError(err.message);
    } finally {
      setDecomposing(false);
    }
  };

  const toggleRule = (index) => {
    setSelected(prev => ({ ...prev, [index]: !prev[index] }));
  };

  const handleSave = async () => {
    const selectedRules = rules.filter((_, i) => selected[i]);
    if (selectedRules.length === 0) {
      onClose();
      return;
    }

    setSaving(true);
    try {
      await post('/ai/prompt-rules', {
        rules: selectedRules,
        accountId: currentAccount?.id,
        sourceFeedback: feedbackHistory.join(' / ')
      });
      onSaved?.(selectedRules.length);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const categoryLabel = (cat) => {
    switch (cat) {
      case 'content': return '内容';
      case 'tone': return 'トーン';
      case 'structure': return '構造';
      case 'style': return '文体';
      default: return cat;
    }
  };

  const categoryColor = (cat) => {
    switch (cat) {
      case 'content': return 'bg-blue-100 text-blue-700';
      case 'tone': return 'bg-green-100 text-green-700';
      case 'structure': return 'bg-purple-100 text-purple-700';
      case 'style': return 'bg-orange-100 text-orange-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl w-full max-w-lg max-h-[80vh] overflow-y-auto">
        <div className="p-4 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900">フィードバックをプロンプトに反映</h3>
          <p className="text-xs text-gray-500 mt-1">
            選択したルールが今後のツイート生成に恒久的に反映されます
          </p>
        </div>

        <div className="p-4 space-y-3">
          {decomposing && (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-purple-600 mr-3" />
              <span className="text-sm text-gray-600">フィードバックを分析中...</span>
            </div>
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}

          {!decomposing && rules.length === 0 && !error && (
            <p className="text-sm text-gray-500 py-4 text-center">
              ルールを抽出できませんでした
            </p>
          )}

          {!decomposing && rules.length > 0 && (
            <>
              <div className="space-y-2">
                {rules.map((rule, i) => (
                  <label
                    key={i}
                    className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                      selected[i] ? 'border-purple-300 bg-purple-50' : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={!!selected[i]}
                      onChange={() => toggleRule(i)}
                      className="mt-0.5 rounded border-gray-300 text-purple-600"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`px-2 py-0.5 text-xs rounded ${categoryColor(rule.category)}`}>
                          {categoryLabel(rule.category)}
                        </span>
                      </div>
                      <p className="text-sm text-gray-800">{rule.text}</p>
                    </div>
                  </label>
                ))}
              </div>

              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-500">
                  元のフィードバック: {feedbackHistory.map((f, i) => (
                    <span key={i} className="inline-block bg-gray-200 rounded px-2 py-0.5 mr-1 mt-1">
                      {f}
                    </span>
                  ))}
                </p>
              </div>
            </>
          )}
        </div>

        <div className="p-4 border-t border-gray-200 flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            スキップ
          </button>
          <button
            onClick={handleSave}
            disabled={decomposing || saving || rules.length === 0}
            className="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors"
          >
            {saving ? '保存中...' : `${Object.values(selected).filter(Boolean).length}件のルールを保存`}
          </button>
        </div>
      </div>
    </div>
  );
}

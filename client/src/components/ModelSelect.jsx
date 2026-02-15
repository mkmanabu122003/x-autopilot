import React, { useState, useEffect } from 'react';
import { useAPI } from '../hooks/useAPI';

export default function ModelSelect({ provider, model, onProviderChange, onModelChange }) {
  const [modelsData, setModelsData] = useState(null);
  const { get } = useAPI();

  useEffect(() => {
    get('/ai/models').then(setModelsData).catch(() => {});
  }, [get]);

  const providers = modelsData ? Object.keys(modelsData) : ['claude', 'gemini'];
  const currentModels = modelsData && modelsData[provider] ? modelsData[provider].models : [];

  return (
    <div className="space-y-2">
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">AIプロバイダー</label>
        <div className="flex rounded-lg border border-gray-300 overflow-hidden">
          {providers.map(p => (
            <button
              key={p}
              type="button"
              onClick={() => {
                onProviderChange(p);
                // Auto-select first model of new provider
                if (modelsData && modelsData[p] && modelsData[p].models.length > 0) {
                  onModelChange(modelsData[p].models[0].id);
                }
              }}
              className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${
                provider === p
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              {modelsData && modelsData[p] ? modelsData[p].label.split(' (')[0] : p}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">モデル</label>
        <select
          value={model}
          onChange={(e) => onModelChange(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          {currentModels.map(m => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
          {currentModels.length === 0 && (
            <option value="">読み込み中...</option>
          )}
        </select>
      </div>
    </div>
  );
}

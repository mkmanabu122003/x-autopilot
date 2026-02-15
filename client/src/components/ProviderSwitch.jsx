import React from 'react';

const providers = [
  { name: 'claude', label: 'Claude' },
  { name: 'gemini', label: 'Gemini' }
];

export default function ProviderSwitch({ value, onChange }) {
  return (
    <div className="flex rounded-lg border border-gray-300 overflow-hidden">
      {providers.map(p => (
        <button
          key={p.name}
          type="button"
          onClick={() => onChange(p.name)}
          className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${
            value === p.name
              ? 'bg-blue-600 text-white'
              : 'bg-white text-gray-700 hover:bg-gray-50'
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

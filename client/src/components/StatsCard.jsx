import React from 'react';

export default function StatsCard({ title, value, subtitle, warning }) {
  return (
    <div className={`bg-white rounded-lg border p-4 ${warning ? 'border-yellow-300' : 'border-gray-200'}`}>
      <p className="text-sm text-gray-500">{title}</p>
      <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
      {subtitle && (
        <p className={`text-xs mt-1 ${warning ? 'text-yellow-600 font-medium' : 'text-gray-400'}`}>
          {subtitle}
        </p>
      )}
    </div>
  );
}

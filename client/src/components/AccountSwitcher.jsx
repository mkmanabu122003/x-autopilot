import React, { useState } from 'react';
import { useAccount } from '../contexts/AccountContext';

export default function AccountSwitcher() {
  const { accounts, currentAccount, switchAccount } = useAccount();
  const [open, setOpen] = useState(false);

  if (accounts.length === 0) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border-2 transition-colors hover:bg-gray-50"
        style={{ borderColor: currentAccount?.color || '#3B82F6' }}
      >
        <span
          className="w-3 h-3 rounded-full flex-shrink-0"
          style={{ backgroundColor: currentAccount?.color || '#3B82F6' }}
        />
        <div className="text-left min-w-0 flex-1">
          <p className="text-sm font-bold text-gray-900 truncate">
            {currentAccount?.display_name || 'アカウント選択'}
          </p>
          <p className="text-xs text-gray-500 truncate">
            @{currentAccount?.handle}
          </p>
        </div>
        <svg className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 max-h-60 overflow-y-auto">
            {accounts.map(account => (
              <button
                key={account.id}
                onClick={() => { switchAccount(account); setOpen(false); }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 transition-colors ${
                  currentAccount?.id === account.id ? 'bg-gray-50' : ''
                }`}
              >
                <span
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: account.color }}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate">{account.display_name}</p>
                  <p className="text-xs text-gray-500 truncate">@{account.handle}</p>
                </div>
                {currentAccount?.id === account.id && (
                  <svg className="w-4 h-4 text-blue-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

import React from 'react';

export default function PostConfirmDialog({ account, text, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl w-full max-w-md">
        <div
          className="p-4 rounded-t-xl text-white font-bold text-center text-lg"
          style={{ backgroundColor: account.color }}
        >
          @{account.handle} に投稿
        </div>
        <div className="p-4 space-y-3">
          <div className="flex items-center gap-2 mb-2">
            <span
              className="w-4 h-4 rounded-full flex-shrink-0"
              style={{ backgroundColor: account.color }}
            />
            <span className="font-bold text-gray-900">{account.display_name}</span>
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{text}</p>
          </div>
          <p className="text-sm text-gray-500 text-center">
            このアカウントに投稿してよろしいですか？
          </p>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              キャンセル
            </button>
            <button
              onClick={onConfirm}
              className="flex-1 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors"
              style={{ backgroundColor: account.color }}
            >
              投稿する
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

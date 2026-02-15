export function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return String(num);
}

export function formatCurrency(usd) {
  return `$${usd.toFixed(2)}`;
}

export function formatPercent(value) {
  return `${value.toFixed(1)}%`;
}

export function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function formatRelativeTime(dateStr) {
  const now = new Date();
  const d = new Date(dateStr);
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return 'たった今';
  if (diffMin < 60) return `${diffMin}分前`;
  if (diffHour < 24) return `${diffHour}時間前`;
  if (diffDay < 7) return `${diffDay}日前`;
  return formatDate(dateStr);
}

export function charCount(text) {
  // Japanese characters count as 2 for Twitter's 280 char limit
  let count = 0;
  for (const char of text) {
    if (char.charCodeAt(0) > 127) {
      count += 2;
    } else {
      count += 1;
    }
  }
  return count;
}

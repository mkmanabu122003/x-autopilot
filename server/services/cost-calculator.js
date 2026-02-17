const modelPricing = require('../config/model-pricing');
const { getDb } = require('../db/database');

function getProviderForModel(modelId) {
  for (const [provider, models] of Object.entries(modelPricing)) {
    if (models[modelId]) return provider;
  }
  return null;
}

function calculateCost(usage, model, isBatch = false) {
  const provider = getProviderForModel(model);
  if (!provider) return 0;

  const pricing = modelPricing[provider][model];
  if (!pricing) return 0;

  let cost = 0;

  // Normal input tokens (excluding cached)
  const cacheRead = usage.cache_read_input_tokens || 0;
  const cacheWrite = usage.cache_creation_input_tokens || 0;
  const normalInput = (usage.input_tokens || 0) - cacheRead - cacheWrite;
  cost += (Math.max(normalInput, 0) / 1_000_000) * pricing.inputPerMTok;

  // Cache write tokens
  if (pricing.cacheWritePerMTok) {
    cost += (cacheWrite / 1_000_000) * pricing.cacheWritePerMTok;
  }

  // Cache read tokens
  if (pricing.cacheReadPerMTok) {
    cost += (cacheRead / 1_000_000) * pricing.cacheReadPerMTok;
  }

  // Output tokens (includes thinking tokens for Claude)
  cost += ((usage.output_tokens || 0) / 1_000_000) * pricing.outputPerMTok;

  // Batch API discount (50% off)
  if (isBatch) cost *= 0.5;

  return parseFloat(cost.toFixed(6));
}

async function logDetailedUsage(params) {
  const {
    provider, model, taskType,
    inputTokens = 0, outputTokens = 0, thinkingTokens = 0,
    cacheReadTokens = 0, cacheWriteTokens = 0,
    isBatch = false, requestId = null, batchId = null
  } = params;

  const usage = {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_input_tokens: cacheReadTokens,
    cache_creation_input_tokens: cacheWriteTokens
  };
  const estimatedCost = calculateCost(usage, model, isBatch);

  try {
    const sb = getDb();
    const { error } = await sb.from('api_usage_logs').insert({
      provider,
      model,
      task_type: taskType,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      thinking_tokens: thinkingTokens,
      cache_read_tokens: cacheReadTokens,
      cache_write_tokens: cacheWriteTokens,
      is_batch: isBatch,
      estimated_cost_usd: estimatedCost,
      request_id: requestId,
      batch_id: batchId
    });
    if (error) {
      console.warn('logDetailedUsage: api_usage_logs insert failed (table may not exist):', error.message);
    }
  } catch (err) {
    console.warn('logDetailedUsage: failed to log usage:', err.message);
  }

  return estimatedCost;
}

async function getMonthlyCostSummary() {
  const sb = getDb();
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  let allRows = [];
  try {
    const { data: rows, error } = await sb.from('api_usage_logs')
      .select('*')
      .gte('timestamp', startOfMonth);

    if (error) {
      console.warn('getMonthlyCostSummary: api_usage_logs query failed (table may not exist):', error.message);
    } else {
      allRows = rows || [];
    }
  } catch (err) {
    console.warn('getMonthlyCostSummary: failed to query usage:', err.message);
  }
  let totalCost = 0;
  let totalCacheRead = 0;
  let totalInput = 0;
  let batchCount = 0;
  let totalCount = allRows.length;
  const byProvider = {};
  const byTask = {};
  const byModel = {};

  for (const row of allRows) {
    totalCost += row.estimated_cost_usd || 0;
    totalCacheRead += row.cache_read_tokens || 0;
    totalInput += row.input_tokens || 0;
    if (row.is_batch) batchCount++;

    // By provider
    if (!byProvider[row.provider]) byProvider[row.provider] = { cost: 0, count: 0 };
    byProvider[row.provider].cost += row.estimated_cost_usd || 0;
    byProvider[row.provider].count++;

    // By task
    if (!byTask[row.task_type]) byTask[row.task_type] = { cost: 0, count: 0 };
    byTask[row.task_type].cost += row.estimated_cost_usd || 0;
    byTask[row.task_type].count++;

    // By model
    if (!byModel[row.model]) byModel[row.model] = {
      cost: 0, count: 0, inputTokens: 0, outputTokens: 0
    };
    byModel[row.model].cost += row.estimated_cost_usd || 0;
    byModel[row.model].count++;
    byModel[row.model].inputTokens += row.input_tokens || 0;
    byModel[row.model].outputTokens += row.output_tokens || 0;
  }

  const cacheHitRate = totalInput > 0 ? (totalCacheRead / totalInput) * 100 : 0;

  // Estimate cache savings
  let cacheSavings = 0;
  for (const row of allRows) {
    if (row.cache_read_tokens > 0 && row.model) {
      const provider = getProviderForModel(row.model);
      if (provider) {
        const pricing = modelPricing[provider][row.model];
        if (pricing && pricing.cacheReadPerMTok) {
          const fullCost = (row.cache_read_tokens / 1_000_000) * pricing.inputPerMTok;
          const cachedCost = (row.cache_read_tokens / 1_000_000) * pricing.cacheReadPerMTok;
          cacheSavings += fullCost - cachedCost;
        }
      }
    }
  }

  return {
    totalCostUsd: parseFloat(totalCost.toFixed(4)),
    cacheSavingsUsd: parseFloat(cacheSavings.toFixed(4)),
    cacheHitRate: parseFloat(cacheHitRate.toFixed(1)),
    batchUsageRate: totalCount > 0 ? parseFloat(((batchCount / totalCount) * 100).toFixed(1)) : 0,
    totalRequests: totalCount,
    byProvider: Object.entries(byProvider).map(([name, data]) => ({
      provider: name,
      cost: parseFloat(data.cost.toFixed(4)),
      count: data.count
    })),
    byTask: Object.entries(byTask).map(([name, data]) => ({
      taskType: name,
      cost: parseFloat(data.cost.toFixed(4)),
      count: data.count
    })),
    byModel: Object.entries(byModel).map(([name, data]) => ({
      model: name,
      cost: parseFloat(data.cost.toFixed(4)),
      count: data.count,
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens
    }))
  };
}

async function getDailyCosts(days = 30) {
  const sb = getDb();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  let rows = [];
  try {
    const { data, error } = await sb.from('api_usage_logs')
      .select('timestamp, estimated_cost_usd')
      .gte('timestamp', cutoff.toISOString());

    if (error) {
      console.warn('getDailyCosts: api_usage_logs query failed (table may not exist):', error.message);
    } else {
      rows = data || [];
    }
  } catch (err) {
    console.warn('getDailyCosts: failed to query usage:', err.message);
  }

  const dailyMap = {};
  for (const row of rows) {
    const dateKey = row.timestamp ? row.timestamp.substring(0, 10) : 'unknown';
    if (!dailyMap[dateKey]) dailyMap[dateKey] = 0;
    dailyMap[dateKey] += row.estimated_cost_usd || 0;
  }

  return Object.entries(dailyMap)
    .map(([date, cost]) => ({ date, cost: parseFloat(cost.toFixed(4)) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function getOptimizationScore() {
  const summary = await getMonthlyCostSummary();

  // Cache hit rate score (0-25)
  const cacheScore = Math.min(summary.cacheHitRate / 4, 25);

  // Batch usage score (0-25)
  const batchScore = Math.min(summary.batchUsageRate / 4, 25);

  // Low-cost model usage score (0-25)
  const lowCostModels = ['claude-haiku-4-5-20251001', 'gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-2.5-flash'];
  const lowCostCount = summary.byModel
    .filter(m => lowCostModels.includes(m.model))
    .reduce((sum, m) => sum + m.count, 0);
  const lowCostRate = summary.totalRequests > 0 ? (lowCostCount / summary.totalRequests) * 100 : 0;
  const modelScore = Math.min(lowCostRate / 4, 25);

  // Overall cost efficiency (0-25) - lower cost per request = better
  const avgCostPerReq = summary.totalRequests > 0 ? summary.totalCostUsd / summary.totalRequests : 0;
  const costScore = avgCostPerReq < 0.001 ? 25 : avgCostPerReq < 0.005 ? 20 : avgCostPerReq < 0.01 ? 15 : avgCostPerReq < 0.05 ? 10 : 5;

  const totalScore = cacheScore + batchScore + modelScore + costScore;

  let grade;
  if (totalScore >= 85) grade = 'A';
  else if (totalScore >= 70) grade = 'B';
  else if (totalScore >= 55) grade = 'C';
  else if (totalScore >= 40) grade = 'D';
  else if (totalScore >= 25) grade = 'E';
  else grade = 'F';

  return {
    totalScore: parseFloat(totalScore.toFixed(1)),
    grade,
    breakdown: {
      cacheHitRate: { score: parseFloat(cacheScore.toFixed(1)), value: summary.cacheHitRate },
      batchUsageRate: { score: parseFloat(batchScore.toFixed(1)), value: summary.batchUsageRate },
      lowCostModelRate: { score: parseFloat(modelScore.toFixed(1)), value: parseFloat(lowCostRate.toFixed(1)) },
      costEfficiency: { score: costScore, avgCostPerRequest: parseFloat(avgCostPerReq.toFixed(6)) }
    }
  };
}

async function checkBudgetStatus() {
  const sb = getDb();
  const summary = await getMonthlyCostSummary();

  // Also add old api_usage_log costs
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const { data: oldRows } = await sb.from('api_usage_log')
    .select('cost_usd')
    .gte('created_at', startOfMonth);
  const oldCost = (oldRows || []).reduce((sum, r) => sum + (r.cost_usd || 0), 0);
  const totalCost = summary.totalCostUsd + oldCost;

  const { data: budgetRow } = await sb.from('settings')
    .select('value').eq('key', 'monthly_budget_usd').single();
  const budget = budgetRow ? parseFloat(budgetRow.value) : 33;

  const usedPercent = budget > 0 ? (totalCost / budget) * 100 : 0;

  let alertLevel = 'none';
  if (usedPercent >= 100) alertLevel = 'critical';
  else if (usedPercent >= 95) alertLevel = 'danger';
  else if (usedPercent >= 80) alertLevel = 'warning';
  else if (usedPercent >= 50) alertLevel = 'info';

  return {
    totalCostUsd: parseFloat(totalCost.toFixed(4)),
    budgetUsd: budget,
    usedPercent: parseFloat(usedPercent.toFixed(1)),
    alertLevel,
    shouldPause: usedPercent >= 100
  };
}

module.exports = {
  calculateCost,
  logDetailedUsage,
  getMonthlyCostSummary,
  getDailyCosts,
  getOptimizationScore,
  checkBudgetStatus,
  getProviderForModel
};

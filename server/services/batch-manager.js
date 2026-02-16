const { getDb } = require('../db/database');
const { logDetailedUsage } = require('./cost-calculator');
const { logApiUsage } = require('./x-api');

class BatchManager {
  constructor() {
    this.apiKey = process.env.CLAUDE_API_KEY;
  }

  async batchGenerate(requests) {
    if (!this.apiKey) throw new Error('CLAUDE_API_KEY environment variable is not set');

    const batchRequests = requests.map((req, i) => ({
      custom_id: `batch_${req.taskType}_${i}_${Date.now()}`,
      params: {
        model: req.model || 'claude-haiku-4-5-20251001',
        max_tokens: req.maxTokens || 512,
        system: req.systemPrompt || '',
        messages: [{ role: 'user', content: req.prompt }]
      }
    }));

    const response = await fetch('https://api.anthropic.com/v1/messages/batches', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({ requests: batchRequests })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`Claude Batch API error ${response.status}: ${JSON.stringify(error)}`);
    }

    const batch = await response.json();

    // Save batch job to DB
    const sb = getDb();
    await sb.from('batch_jobs').insert({
      batch_id: batch.id,
      status: 'processing',
      task_type: requests[0]?.taskType || 'tweet_generation',
      request_count: batchRequests.length,
      completed_count: 0
    });

    return {
      batchId: batch.id,
      requestCount: batchRequests.length,
      status: 'processing'
    };
  }

  async checkBatchStatus(batchId) {
    if (!this.apiKey) throw new Error('CLAUDE_API_KEY environment variable is not set');

    const response = await fetch(`https://api.anthropic.com/v1/messages/batches/${batchId}`, {
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01'
      }
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`Claude Batch API error ${response.status}: ${JSON.stringify(error)}`);
    }

    return response.json();
  }

  async getBatchResults(batchId) {
    if (!this.apiKey) throw new Error('CLAUDE_API_KEY environment variable is not set');

    const response = await fetch(`https://api.anthropic.com/v1/messages/batches/${batchId}/results`, {
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01'
      }
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`Claude Batch API error ${response.status}: ${JSON.stringify(error)}`);
    }

    // Results are returned as JSONL
    const text = await response.text();
    const results = text.trim().split('\n').map(line => JSON.parse(line));
    return results;
  }

  async pollBatchResults() {
    const sb = getDb();
    const { data: pendingJobs } = await sb.from('batch_jobs')
      .select('*')
      .eq('status', 'processing');

    if (!pendingJobs || pendingJobs.length === 0) return;

    for (const job of pendingJobs) {
      try {
        const batch = await this.checkBatchStatus(job.batch_id);

        if (batch.processing_status === 'ended') {
          const results = await this.getBatchResults(job.batch_id);

          // Log usage for each result
          for (const result of results) {
            if (result.result?.type === 'succeeded') {
              const usage = result.result.message?.usage || {};
              await logDetailedUsage({
                provider: 'claude',
                model: result.result.message?.model || 'unknown',
                taskType: job.task_type,
                inputTokens: usage.input_tokens || 0,
                outputTokens: usage.output_tokens || 0,
                isBatch: true,
                batchId: job.batch_id
              });
            }
          }

          // Parse results into draft posts
          const drafts = this.parseResultsIntoDrafts(results, job.task_type);

          await sb.from('batch_jobs').update({
            status: 'completed',
            completed_count: results.length,
            completed_at: new Date().toISOString(),
            results: drafts
          }).eq('batch_id', job.batch_id);

          await logApiUsage('claude_batch', `Batch ${job.batch_id}`, 0, null);
        } else if (batch.processing_status === 'errored') {
          await sb.from('batch_jobs').update({
            status: 'failed',
            completed_at: new Date().toISOString()
          }).eq('batch_id', job.batch_id);
        }
      } catch (err) {
        console.error(`Error polling batch ${job.batch_id}:`, err.message);
      }
    }
  }

  parseResultsIntoDrafts(results, taskType) {
    const drafts = [];

    for (const result of results) {
      if (result.result?.type !== 'succeeded') continue;

      const message = result.result.message;
      let text = '';
      if (Array.isArray(message?.content)) {
        for (const block of message.content) {
          if (block.type === 'text') text += block.text;
        }
      }

      if (text) {
        // Parse multiple candidates from the text
        const patterns = text.split(/(?:^|\n)(?:\d+[\.\)]\s*|パターン\d+[:：]\s*)/);
        for (const pattern of patterns) {
          const trimmed = pattern.trim();
          if (!trimmed) continue;
          drafts.push({
            text: trimmed,
            customId: result.custom_id,
            taskType
          });
        }
      }
    }

    return drafts;
  }

  async getHistory(limit = 20) {
    const sb = getDb();
    const { data, error } = await sb.from('batch_jobs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  }

  async getJob(batchId) {
    const sb = getDb();
    const { data, error } = await sb.from('batch_jobs')
      .select('*')
      .eq('batch_id', batchId)
      .single();

    if (error) throw error;
    return data;
  }
}

module.exports = { BatchManager };

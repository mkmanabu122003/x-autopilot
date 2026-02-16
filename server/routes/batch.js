const express = require('express');
const router = express.Router();
const { BatchManager } = require('../services/batch-manager');
const { getDb } = require('../db/database');
const { AIProvider } = require('../services/ai-provider');
const defaultPrompts = require('../config/prompts');

const batchManager = new BatchManager();
const aiProvider = new AIProvider();

// POST /api/batch/generate - Submit batch generation request
router.post('/generate', async (req, res) => {
  try {
    const { themes, taskType = 'tweet_generation', model, accountId } = req.body;

    if (!themes || !Array.isArray(themes) || themes.length === 0) {
      return res.status(400).json({ error: 'themes array is required' });
    }

    // Check if batch is enabled
    const costSettings = await aiProvider.getCostSettings();
    if (!costSettings.batch_enabled) {
      return res.status(400).json({ error: 'Batch APIが無効になっています。設定画面で有効にしてください。' });
    }

    // Get task model settings for default model
    const taskSettings = await aiProvider.getTaskModelSettings(taskType, 'claude');
    const resolvedModel = model || taskSettings.model || 'claude-haiku-4-5-20251001';
    const maxTokens = taskSettings.maxTokens || 512;

    // Get system prompt for the task type
    let systemPrompt = '';
    if (defaultPrompts[taskType]) {
      systemPrompt = defaultPrompts[taskType].system;
    } else {
      systemPrompt = await aiProvider.getSystemPrompt({ taskType });
    }

    // Build batch requests
    const requests = themes.map(theme => ({
      taskType,
      model: resolvedModel,
      maxTokens,
      systemPrompt,
      prompt: `テーマ「${theme}」でツイートを3パターン作成してください。`
    }));

    const result = await batchManager.batchGenerate(requests);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/batch/status/:batchId - Check batch status
router.get('/status/:batchId', async (req, res) => {
  try {
    const job = await batchManager.getJob(req.params.batchId);
    if (!job) {
      return res.status(404).json({ error: 'Batch job not found' });
    }
    res.json(job);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/batch/results/:batchId - Get batch results
router.get('/results/:batchId', async (req, res) => {
  try {
    const job = await batchManager.getJob(req.params.batchId);
    if (!job) {
      return res.status(404).json({ error: 'Batch job not found' });
    }

    if (job.status !== 'completed') {
      return res.json({ status: job.status, results: null });
    }

    res.json({
      status: 'completed',
      results: job.results,
      completedAt: job.completed_at
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/batch/history - List batch job history
router.get('/history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const history = await batchManager.getHistory(limit);
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

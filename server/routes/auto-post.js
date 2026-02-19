const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { runAutoPostManually } = require('../services/auto-poster');

// GET /api/auto-post/settings - Get auto post settings for an account
router.get('/settings', async (req, res) => {
  try {
    const sb = getDb();
    const accountId = req.query.accountId;

    let query = sb.from('auto_post_settings')
      .select('*, x_accounts(display_name, handle)')
      .order('post_type');

    if (accountId) {
      query = query.eq('account_id', accountId);
    }

    const { data, error } = await query;
    if (error) throw error;

    const settings = (data || []).map(s => ({
      ...s,
      account_name: s.x_accounts?.display_name,
      account_handle: s.x_accounts?.handle,
      x_accounts: undefined
    }));

    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/auto-post/settings - Create or update auto post setting
router.put('/settings', async (req, res) => {
  try {
    const { accountId, postType, enabled, postsPerDay, scheduleTimes, scheduleMode, themes, tone, targetAudience, styleNote, aiModel, maxLength } = req.body;

    if (!accountId || !postType) {
      return res.status(400).json({ error: 'accountId and postType are required' });
    }
    if (!['new', 'reply', 'quote'].includes(postType)) {
      return res.status(400).json({ error: 'postType must be new, reply, or quote' });
    }

    // Validate schedule_times format
    if (scheduleTimes) {
      const times = scheduleTimes.split(',').map(t => t.trim());
      for (const time of times) {
        if (!/^\d{2}:\d{2}$/.test(time)) {
          return res.status(400).json({ error: `Invalid time format: ${time}. Use HH:MM` });
        }
      }
    }

    const sb = getDb();
    const row = {
      account_id: accountId,
      post_type: postType,
      enabled: enabled !== undefined ? enabled : false,
      posts_per_day: postsPerDay || 1,
      schedule_times: scheduleTimes || '09:00',
      schedule_mode: scheduleMode || 'scheduled',
      themes: themes || '',
      tone: tone || '',
      target_audience: targetAudience || '',
      style_note: styleNote || '',
      ai_model: aiModel || '',
      max_length: maxLength || 0,
      updated_at: new Date().toISOString()
    };

    const { data, error } = await sb.from('auto_post_settings')
      .upsert(row, { onConflict: 'account_id,post_type' })
      .select('id')
      .single();

    if (error) throw error;
    res.json({ success: true, id: data.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/auto-post/settings/:id - Delete auto post setting
router.delete('/settings/:id', async (req, res) => {
  try {
    const sb = getDb();
    const { error } = await sb.from('auto_post_settings')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/auto-post/run/:id - Manually trigger auto post
router.post('/run/:id', async (req, res) => {
  try {
    const result = await runAutoPostManually(parseInt(req.params.id));
    res.json(result);
  } catch (error) {
    console.error('Auto-post manual run error:', error);
    res.status(500).json({
      error: error.message,
      details: error.stack ? error.stack.split('\n').slice(0, 3).join('\n') : undefined
    });
  }
});

// GET /api/auto-post/logs - Get auto post execution logs
router.get('/logs', async (req, res) => {
  try {
    const sb = getDb();
    const accountId = req.query.accountId;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;

    // Build count query
    let countQuery = sb.from('auto_post_logs')
      .select('id', { count: 'exact', head: true });
    if (accountId) {
      countQuery = countQuery.eq('account_id', accountId);
    }

    // Build data query
    let query = sb.from('auto_post_logs')
      .select('*, x_accounts(display_name, handle)')
      .order('executed_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (accountId) {
      query = query.eq('account_id', accountId);
    }

    const [countResult, dataResult] = await Promise.all([countQuery, query]);

    if (dataResult.error) throw dataResult.error;

    const logs = (dataResult.data || []).map(l => ({
      ...l,
      account_name: l.x_accounts?.display_name,
      account_handle: l.x_accounts?.handle,
      x_accounts: undefined
    }));

    res.json({ logs, total: countResult.count || 0, limit, offset });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

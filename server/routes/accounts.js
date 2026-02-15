const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');

const ACCOUNT_COLORS = [
  '#3B82F6', // blue
  '#EF4444', // red
  '#10B981', // green
  '#F59E0B', // amber
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#06B6D4', // cyan
  '#F97316', // orange
];

// GET /api/accounts - List all accounts (credentials masked)
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const accounts = db.prepare(`
      SELECT id, display_name, handle, color, default_ai_provider, default_ai_model, created_at
      FROM x_accounts ORDER BY created_at ASC
    `).all();
    res.json(accounts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/accounts/:id - Get single account (credentials masked)
router.get('/:id', (req, res) => {
  try {
    const db = getDb();
    const account = db.prepare(`
      SELECT id, display_name, handle, color, default_ai_provider, default_ai_model,
             api_key, api_secret, access_token, access_token_secret, bearer_token, created_at
      FROM x_accounts WHERE id = ?
    `).get(req.params.id);

    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    // Mask credentials for display (show last 4 chars)
    const mask = (s) => s ? '****' + s.slice(-4) : '';
    res.json({
      ...account,
      api_key: mask(account.api_key),
      api_secret: mask(account.api_secret),
      access_token: mask(account.access_token),
      access_token_secret: mask(account.access_token_secret),
      bearer_token: mask(account.bearer_token),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/accounts - Create account
router.post('/', (req, res) => {
  try {
    const { display_name, handle, color, api_key, api_secret, access_token, access_token_secret, bearer_token, default_ai_provider, default_ai_model } = req.body;

    if (!display_name || !handle || !api_key || !api_secret || !access_token || !access_token_secret) {
      return res.status(400).json({ error: 'display_name, handle, api_key, api_secret, access_token, access_token_secret are required' });
    }

    const db = getDb();

    // Auto-assign color if not provided
    const existingCount = db.prepare('SELECT COUNT(*) as count FROM x_accounts').get().count;
    const assignedColor = color || ACCOUNT_COLORS[existingCount % ACCOUNT_COLORS.length];

    const result = db.prepare(`
      INSERT INTO x_accounts (display_name, handle, color, api_key, api_secret, access_token, access_token_secret, bearer_token, default_ai_provider, default_ai_model)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      display_name,
      handle.replace('@', ''),
      assignedColor,
      api_key,
      api_secret,
      access_token,
      access_token_secret,
      bearer_token || '',
      default_ai_provider || 'claude',
      default_ai_model || 'claude-sonnet-4-20250514'
    );

    res.json({
      id: result.lastInsertRowid,
      display_name,
      handle: handle.replace('@', ''),
      color: assignedColor,
      default_ai_provider: default_ai_provider || 'claude',
      default_ai_model: default_ai_model || 'claude-sonnet-4-20250514'
    });
  } catch (error) {
    if (error.message.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'このハンドルは既に登録されています' });
    }
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/accounts/:id - Update account
router.put('/:id', (req, res) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM x_accounts WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const fields = ['display_name', 'handle', 'color', 'api_key', 'api_secret', 'access_token', 'access_token_secret', 'bearer_token', 'default_ai_provider', 'default_ai_model'];
    const updates = [];
    const params = [];

    for (const field of fields) {
      if (req.body[field] !== undefined && req.body[field] !== '') {
        // Skip masked credential values (they start with ****)
        if (['api_key', 'api_secret', 'access_token', 'access_token_secret', 'bearer_token'].includes(field)) {
          if (req.body[field].startsWith('****')) continue;
        }
        updates.push(`${field} = ?`);
        params.push(field === 'handle' ? req.body[field].replace('@', '') : req.body[field]);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    params.push(req.params.id);
    db.prepare(`UPDATE x_accounts SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/accounts/:id - Delete account
router.delete('/:id', (req, res) => {
  try {
    const db = getDb();
    const result = db.prepare('DELETE FROM x_accounts WHERE id = ?').run(req.params.id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Account not found' });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

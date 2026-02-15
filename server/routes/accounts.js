const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { encrypt, decrypt } = require('../utils/crypto');

const ACCOUNT_COLORS = [
  '#3B82F6', '#EF4444', '#10B981', '#F59E0B',
  '#8B5CF6', '#EC4899', '#06B6D4', '#F97316',
];

const SENSITIVE_FIELDS = ['api_key', 'api_secret', 'access_token', 'access_token_secret', 'bearer_token'];

// GET /api/accounts
router.get('/', async (req, res) => {
  try {
    const sb = getDb();
    const { data, error } = await sb
      .from('x_accounts')
      .select('id, display_name, handle, color, default_ai_provider, default_ai_model, created_at')
      .order('created_at', { ascending: true });
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/accounts/:id
router.get('/:id', async (req, res) => {
  try {
    const sb = getDb();
    const { data, error } = await sb
      .from('x_accounts')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Account not found' });

    const mask = (s) => {
      const plain = decrypt(s);
      return plain ? '****' + plain.slice(-4) : '';
    };

    res.json({
      ...data,
      api_key: mask(data.api_key),
      api_secret: mask(data.api_secret),
      access_token: mask(data.access_token),
      access_token_secret: mask(data.access_token_secret),
      bearer_token: mask(data.bearer_token),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/accounts
router.post('/', async (req, res) => {
  try {
    const { display_name, handle, color, api_key, api_secret, access_token, access_token_secret, bearer_token, default_ai_provider, default_ai_model } = req.body;

    if (!display_name || !handle || !api_key || !api_secret || !access_token || !access_token_secret) {
      return res.status(400).json({ error: 'display_name, handle, api_key, api_secret, access_token, access_token_secret are required' });
    }

    const sb = getDb();
    const { count } = await sb.from('x_accounts').select('*', { count: 'exact', head: true });
    const assignedColor = color || ACCOUNT_COLORS[(count || 0) % ACCOUNT_COLORS.length];

    const { data, error } = await sb.from('x_accounts').insert({
      display_name,
      handle: handle.replace('@', ''),
      color: assignedColor,
      api_key: encrypt(api_key),
      api_secret: encrypt(api_secret),
      access_token: encrypt(access_token),
      access_token_secret: encrypt(access_token_secret),
      bearer_token: encrypt(bearer_token || ''),
      default_ai_provider: default_ai_provider || 'claude',
      default_ai_model: default_ai_model || 'claude-sonnet-4-20250514'
    }).select('id, display_name, handle, color, default_ai_provider, default_ai_model').single();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'このハンドルは既に登録されています' });
      }
      throw error;
    }
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/accounts/:id
router.put('/:id', async (req, res) => {
  try {
    const sb = getDb();
    const updates = {};

    for (const field of ['display_name', 'color', 'default_ai_provider', 'default_ai_model']) {
      if (req.body[field] !== undefined && req.body[field] !== '') {
        updates[field] = req.body[field];
      }
    }
    if (req.body.handle !== undefined && req.body.handle !== '') {
      updates.handle = req.body.handle.replace('@', '');
    }
    for (const field of SENSITIVE_FIELDS) {
      if (req.body[field] !== undefined && req.body[field] !== '' && !req.body[field].startsWith('****')) {
        updates[field] = encrypt(req.body[field]);
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const { error } = await sb.from('x_accounts').update(updates).eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/accounts/:id
router.delete('/:id', async (req, res) => {
  try {
    const sb = getDb();
    const { error } = await sb.from('x_accounts').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

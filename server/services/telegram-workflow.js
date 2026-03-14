const crypto = require('crypto');
const { getDb } = require('../db/database');
const { getAIProvider } = require('./ai-provider');
const { postTweet } = require('./x-api');
const { sendTweetProposal, sendNotification, updateMessage, initTelegramBot, getTelegramChatId, getBot } = require('./telegram-bot');
const { logError, logInfo } = require('./app-logger');

/**
 * Generate tweet proposals and send them to Telegram for approval.
 * @param {string} accountId - X account ID
 * @param {object} options - { theme, postType, aiProvider, aiModel }
 * @returns {object} { generated, postIds }
 */
async function triggerTweetProposal(accountId, options = {}) {
  const {
    theme = '自由テーマ',
    postType = 'new',
    aiProvider: providerName = 'claude',
    aiModel
  } = options;

  const chatId = await getTelegramChatId();
  if (!chatId) throw new Error('Telegram Chat ID が設定されていません。Supabase の settings テーブルに telegram_chat_id を登録してください。');

  const provider = getAIProvider(providerName);
  const genOptions = {
    postType,
    accountId,
    includeCompetitorContext: true
  };
  if (aiModel) genOptions.model = aiModel;

  const result = await provider.generateTweets(theme, genOptions);

  if (!result.candidates || result.candidates.length === 0) {
    throw new Error('ツイート案の生成に失敗しました');
  }

  const sb = getDb();

  // Filter valid candidates and batch-insert all drafts at once
  const batchId = crypto.randomUUID();
  const validCandidates = result.candidates.filter(c => c.text && c.text.trim());
  const insertRows = validCandidates.map(candidate => ({
    account_id: accountId,
    text: candidate.text,
    post_type: postType,
    status: 'draft',
    ai_provider: result.provider,
    ai_model: result.model,
    telegram_chat_id: chatId,
    generation_theme: theme,
    generation_batch_id: batchId
  }));

  const { data: posts, error } = await sb.from('my_posts')
    .insert(insertRows).select('id, text');

  if (error || !posts) {
    const errMsg = error?.message || '下書きの保存に失敗しました';
    logError('telegram', `下書き一括保存エラー`, { error: errMsg });
    throw new Error(`下書き保存エラー: ${errMsg}`);
  }

  // Send proposals to Telegram in parallel and collect message ID updates
  const sendResults = await Promise.all(posts.map((post, i) =>
    sendTweetProposal(chatId, {
      postId: post.id,
      text: post.text,
      index: i + 1,
      total: posts.length,
      postType,
      factCheck: validCandidates[i]?.factCheck || null
    }).catch(() => null)
  ));

  const messageUpdates = sendResults
    .map((sent, i) => sent ? { id: posts[i].id, telegram_message_id: String(sent.message_id) } : null)
    .filter(Boolean);

  // Batch-update telegram_message_id
  if (messageUpdates.length > 0) {
    await Promise.all(messageUpdates.map(u =>
      sb.from('my_posts').update({ telegram_message_id: u.telegram_message_id }).eq('id', u.id)
    ));
  }

  const postIds = posts.map(p => p.id);
  logInfo('telegram', `ツイート案を${postIds.length}件送信しました`, { accountId, postIds });
  return { generated: postIds.length, postIds };
}

/**
 * Approve a tweet: post it to X and notify via Telegram.
 * @param {string} postId - my_posts.id
 */
async function approveTweet(postId) {
  const sb = getDb();

  const { data: post, error } = await sb.from('my_posts')
    .select('*')
    .eq('id', postId)
    .eq('status', 'draft')
    .single();

  if (error || !post) throw new Error('下書きが見つかりません');

  const postOptions = { accountId: post.account_id };
  if (post.post_type === 'reply' && post.target_tweet_id) {
    postOptions.replyToId = post.target_tweet_id;
  } else if (post.post_type === 'quote' && post.target_tweet_id) {
    postOptions.quoteTweetId = post.target_tweet_id;
  }

  let xResult;
  try {
    xResult = await postTweet(post.text, postOptions);
  } catch (err) {
    // Post failed: notify and keep as draft
    const chatId = post.telegram_chat_id || await getTelegramChatId();
    if (chatId) {
      await sendNotification(chatId, `❌ 投稿に失敗しました\n\nエラー: ${err.message}`);
    }
    await sb.from('my_posts')
      .update({ status: 'failed', error_message: err.message })
      .eq('id', postId);
    throw err;
  }

  // Update post status
  await sb.from('my_posts')
    .update({
      tweet_id: xResult.data.id,
      status: 'posted',
      posted_at: new Date().toISOString()
    })
    .eq('id', postId);

  // Auto-reject other drafts in the same batch to prevent double-posting
  if (post.generation_batch_id) {
    const { data: siblings } = await sb.from('my_posts')
      .select('id, telegram_chat_id, telegram_message_id, text')
      .eq('generation_batch_id', post.generation_batch_id)
      .eq('status', 'draft')
      .neq('id', postId);

    if (siblings && siblings.length > 0) {
      await Promise.all(siblings.map(s =>
        sb.from('my_posts').update({ status: 'rejected' }).eq('id', s.id)
      ));

      // Update Telegram messages for auto-rejected siblings
      const siblingChatId = post.telegram_chat_id || await getTelegramChatId();
      if (siblingChatId) {
        await Promise.all(siblings.filter(s => s.telegram_message_id).map(s =>
          updateMessage(siblingChatId, Number(s.telegram_message_id),
            `🚫 自動却下（別の案が投稿されました）\n━━━━━━━━━━━━━━━━\n${s.text}`)
        ));
      }

      logInfo('telegram', `同バッチの${siblings.length}件を自動却下しました`, { batchId: post.generation_batch_id });
    }
  }

  // Notify success via Telegram
  const chatId = post.telegram_chat_id || await getTelegramChatId();
  if (chatId) {
    if (post.telegram_message_id) {
      await updateMessage(chatId, Number(post.telegram_message_id),
        `✅ 投稿完了!\n━━━━━━━━━━━━━━━━\n${post.text}\n━━━━━━━━━━━━━━━━\n🔗 Tweet ID: ${xResult.data.id}`);
    } else {
      await sendNotification(chatId,
        `✅ 投稿完了!\n━━━━━━━━━━━━━━━━\n${post.text}\n━━━━━━━━━━━━━━━━\n🔗 Tweet ID: ${xResult.data.id}`);
    }
  }

  logInfo('telegram', 'ツイートを投稿しました', { postId, tweetId: xResult.data.id });
  return { tweetId: xResult.data.id };
}

/**
 * Reject a tweet: mark as rejected and update Telegram message.
 * @param {string} postId
 */
async function rejectTweet(postId) {
  const sb = getDb();

  const { data: post, error } = await sb.from('my_posts')
    .select('*')
    .eq('id', postId)
    .eq('status', 'draft')
    .single();

  if (error || !post) throw new Error('下書きが見つかりません');

  await sb.from('my_posts')
    .update({ status: 'rejected' })
    .eq('id', postId);

  const chatId = post.telegram_chat_id || await getTelegramChatId();
  if (chatId && post.telegram_message_id) {
    await updateMessage(chatId, Number(post.telegram_message_id),
      `❌ 却下済み\n━━━━━━━━━━━━━━━━\n${post.text}`);
  }

  logInfo('telegram', 'ツイート案を却下しました', { postId });
}

/**
 * Regenerate a tweet: generate a new version and send to Telegram.
 * @param {string} postId
 */
async function regenerateTweet(postId) {
  const sb = getDb();

  const { data: post, error } = await sb.from('my_posts')
    .select('*')
    .eq('id', postId)
    .eq('status', 'draft')
    .single();

  if (error || !post) throw new Error('下書きが見つかりません');

  // Mark old post as rejected
  await sb.from('my_posts')
    .update({ status: 'rejected' })
    .eq('id', postId);

  // Update old Telegram message
  const chatId = post.telegram_chat_id || await getTelegramChatId();
  if (chatId && post.telegram_message_id) {
    await updateMessage(chatId, Number(post.telegram_message_id),
      `🔄 再生成中...\n━━━━━━━━━━━━━━━━\n${post.text}`);
  }

  // Generate new proposals, preserving the original theme
  const providerName = post.ai_provider || 'claude';
  const result = await triggerTweetProposal(post.account_id, {
    theme: post.generation_theme || '自由テーマ',
    postType: post.post_type,
    aiProvider: providerName,
    aiModel: post.ai_model
  });

  return result;
}

/**
 * Show a confirmation step before approving a tweet with fact-check warnings.
 * Replaces the original message buttons with "本当に投稿" / "やっぱりやめる".
 * @param {string} postId
 * @param {string} chatId
 */
async function confirmApprove(postId, chatId) {
  const sb = getDb();

  const { data: post, error } = await sb.from('my_posts')
    .select('*')
    .eq('id', postId)
    .eq('status', 'draft')
    .single();

  if (error || !post) throw new Error('下書きが見つかりません');

  const confirmMessage = `⚠️ ファクトチェック警告あり\n━━━━━━━━━━━━━━━━\n${post.text}\n━━━━━━━━━━━━━━━━\n本当にこのまま投稿しますか？`;

  const keyboard = {
    inline_keyboard: [[
      { text: '✅ 本当に投稿', callback_data: `force_approve:${postId}` },
      { text: '❌ やっぱりやめる', callback_data: `reject:${postId}` }
    ]]
  };

  if (post.telegram_message_id) {
    const bot = getBot();
    if (bot) {
      await bot.editMessageText(confirmMessage, {
        chat_id: chatId,
        message_id: Number(post.telegram_message_id),
        reply_markup: keyboard
      });
    }
  } else {
    await sendNotification(chatId, confirmMessage);
  }
}

/**
 * Start edit mode: create a telegram session to collect feedback text.
 * @param {string} postId
 * @param {string} chatId
 */
async function startEditSession(postId, chatId) {
  const sb = getDb();

  // Verify the post exists and is a draft
  const { data: post, error } = await sb.from('my_posts')
    .select('id')
    .eq('id', postId)
    .eq('status', 'draft')
    .single();

  if (error || !post) throw new Error('下書きが見つかりません');

  // Clean up old sessions for this chat
  await sb.from('telegram_sessions')
    .delete()
    .eq('chat_id', String(chatId));

  // Create new session
  await sb.from('telegram_sessions').insert({
    chat_id: String(chatId),
    post_id: postId,
    state: 'awaiting_feedback'
  });

  await sendNotification(chatId,
    '✏️ 編集依頼モード\n\nどのように修正してほしいか、テキストで送信してください。\n（例: 「もっとカジュアルに」「数字を入れて」「短くして」）');
}

/**
 * Process edit feedback: regenerate the tweet with the user's feedback.
 * @param {string} chatId
 * @param {string} feedback - User's text feedback
 */
async function processEditFeedback(chatId, feedback) {
  const sb = getDb();

  // Find active session
  const { data: session, error } = await sb.from('telegram_sessions')
    .select('*')
    .eq('chat_id', String(chatId))
    .eq('state', 'awaiting_feedback')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !session) return false; // No active session

  // Check if expired
  if (new Date(session.expires_at) < new Date()) {
    await sb.from('telegram_sessions').delete().eq('id', session.id);
    await sendNotification(chatId, '⏰ 編集セッションの有効期限が切れました。再度ボタンを押してください。');
    return true;
  }

  // Get original post
  const { data: post } = await sb.from('my_posts')
    .select('*')
    .eq('id', session.post_id)
    .single();

  if (!post) {
    await sb.from('telegram_sessions').delete().eq('id', session.id);
    await sendNotification(chatId, '元の下書きが見つかりません。');
    return true;
  }

  // Clean up session
  await sb.from('telegram_sessions').delete().eq('id', session.id);

  await sendNotification(chatId, '🔄 フィードバックを反映して再生成中...');

  // Mark old post as rejected
  await sb.from('my_posts')
    .update({ status: 'rejected' })
    .eq('id', post.id);

  // Regenerate with feedback
  const providerName = post.ai_provider || 'claude';
  const provider = getAIProvider(providerName);

  const customPrompt = `以下の元ツイートを、ユーザーのフィードバックに基づいて修正し、3パターン作成してください。

# 元ツイート
${post.text}

# ユーザーフィードバック
${feedback}

bodyにはそのまま投稿できる完成テキストだけを書いてください。ラベルや注釈やハッシュタグは含めないこと。`;

  const genOptions = {
    postType: post.post_type,
    accountId: post.account_id,
    customPrompt
  };
  if (post.ai_model) genOptions.model = post.ai_model;

  const result = await provider.generateTweets('修正', genOptions);

  if (!result.candidates || result.candidates.length === 0) {
    await sendNotification(chatId, '❌ 修正案の生成に失敗しました');
    return true;
  }

  // Batch-insert new proposals
  const validCandidates = result.candidates.filter(c => c.text && c.text.trim());
  const insertRows = validCandidates.map(candidate => ({
    account_id: post.account_id,
    text: candidate.text,
    post_type: post.post_type,
    target_tweet_id: post.target_tweet_id,
    status: 'draft',
    ai_provider: result.provider,
    ai_model: result.model,
    telegram_chat_id: String(chatId)
  }));

  const { data: newPosts } = await sb.from('my_posts')
    .insert(insertRows).select('id, text');

  if (newPosts) {
    // Send proposals to Telegram in parallel
    const sendResults = await Promise.all(newPosts.map((np, i) =>
      sendTweetProposal(chatId, {
        postId: np.id,
        text: np.text,
        index: i + 1,
        total: newPosts.length,
        postType: post.post_type
      }).catch(() => null)
    ));

    const messageUpdates = sendResults
      .map((sent, i) => sent ? { id: newPosts[i].id, telegram_message_id: String(sent.message_id) } : null)
      .filter(Boolean);

    // Batch-update telegram_message_id
    if (messageUpdates.length > 0) {
      await Promise.all(messageUpdates.map(u =>
        sb.from('my_posts').update({ telegram_message_id: u.telegram_message_id }).eq('id', u.id)
      ));
    }
  }

  return true;
}

/**
 * Initialize the Telegram workflow by setting up bot handlers.
 */
function initTelegramWorkflow() {
  return initTelegramBot({
    onCallback: handleCallback,
    onMessage: handleMessage
  });
}

/**
 * Handle inline keyboard button presses.
 */
async function handleCallback(query) {
  const data = query.data;
  const chatId = query.message.chat.id;

  const [action, postId] = data.split(':');

  switch (action) {
    case 'approve':
      await approveTweet(postId);
      break;
    case 'confirm_approve':
      await confirmApprove(postId, chatId);
      break;
    case 'force_approve':
      await approveTweet(postId);
      break;
    case 'reject':
      await rejectTweet(postId);
      break;
    case 'regenerate':
      await regenerateTweet(postId);
      break;
    case 'edit':
      await startEditSession(postId, chatId);
      break;
    default:
      console.warn('Telegram: unknown callback action:', action);
  }
}

/**
 * Handle text messages (for edit feedback flow).
 */
async function handleMessage(msg) {
  if (!msg.text || msg.text.startsWith('/')) return;
  const chatId = msg.chat.id;
  await processEditFeedback(chatId, msg.text);
}

module.exports = {
  triggerTweetProposal,
  approveTweet,
  confirmApprove,
  rejectTweet,
  regenerateTweet,
  startEditSession,
  processEditFeedback,
  initTelegramWorkflow,
  handleCallback,
  handleMessage
};

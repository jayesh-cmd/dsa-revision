require('dotenv').config();
// backend/index.js
// Express API — receives data from extension, handles Telegram webhook
// Deploy on Railway / Render (free tier)

const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ─── CORS for browser extension ───────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Link-Code');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ─── Middleware: verify link code from extension ───────────────────────────────
async function verifyLinkCode(req, res, next) {
  const linkCode = req.headers['x-link-code'];
  if (!linkCode) return res.status(401).json({ error: 'Missing link code' });

  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('link_code', linkCode)
    .eq('link_code_used', true)
    .single();

  if (error || !user) return res.status(401).json({ error: 'Invalid or unused link code' });

  req.user = user;
  next();
}

// ─── EXTENSION: Log a solved question ─────────────────────────────────────────
// Called by browser extension when LeetCode shows "Accepted"
app.post('/api/solved', verifyLinkCode, async (req, res) => {
  const { question_title, question_slug, question_url, difficulty, topic } = req.body;

  if (!question_title) {
    return res.status(400).json({ error: 'question_title is required' });
  }

  // Avoid duplicate logs for same question on same day
  const { data: existing } = await supabase
    .from('solved_questions')
    .select('id')
    .eq('user_id', req.user.id)
    .eq('question_slug', question_slug)
    .eq('solved_at', new Date().toISOString().split('T')[0])
    .single();

  if (existing) {
    return res.json({ message: 'Already logged today', duplicate: true });
  }

  const { data, error } = await supabase
    .from('solved_questions')
    .insert({
      user_id: req.user.id,
      question_title,
      question_slug,
      question_url,
      difficulty,
      topic,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  // Trigger will auto-create revision schedule in DB
  res.json({ success: true, question: data });
});

// ─── TELEGRAM WEBHOOK ─────────────────────────────────────────────────────────
app.post('/api/telegram-webhook', async (req, res) => {
  const update = req.body;

  // Handle messages only
  const message = update.message;
  if (!message) return res.sendStatus(200);

  const chatId = message.chat.id.toString();
  const text = (message.text || '').trim().toLowerCase();

  // /start — register user and generate link code
  if (text === '/start') {
    await handleStart(chatId, message.from);
    return res.sendStatus(200);
  }

  // "done" — mark all today's revisions as done
  if (text === 'done') {
    await handleDoneAll(chatId);
    return res.sendStatus(200);
  }

  // "done 1,3" — mark specific revisions by index
  if (text.startsWith('done ')) {
    const indices = text.replace('done ', '').split(',').map(n => parseInt(n.trim()) - 1);
    await handleDoneSpecific(chatId, indices);
    return res.sendStatus(200);
  }

  // /status — show today's pending revisions
  if (text === '/status') {
    await handleStatus(chatId);
    return res.sendStatus(200);
  }

  res.sendStatus(200);
});

// ─── Telegram helpers ──────────────────────────────────────────────────────────

async function sendTelegram(chatId, text) {
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
}

async function handleStart(chatId, from) {
  // Check if user already exists
  const { data: existing } = await supabase
    .from('users')
    .select('*')
    .eq('telegram_chat_id', chatId)
    .single();

  if (existing) {
    await sendTelegram(chatId,
      `Welcome back! Your link code is: <code>${existing.link_code}</code>\n\nPaste this in the browser extension to connect.`
    );
    return;
  }

  // Generate unique link code
  const linkCode = 'DSA-' + Math.floor(1000 + Math.random() * 9000);

  await supabase.from('users').insert({
    telegram_chat_id: chatId,
    telegram_username: from.username || '',
    link_code: linkCode,
    link_code_used: false,
  });

  await sendTelegram(chatId,
    `👋 Welcome to DSA Revision Tracker!\n\n` +
    `Your link code is: <code>${linkCode}</code>\n\n` +
    `Paste this code in the browser extension settings to connect your LeetCode activity.\n\n` +
    `Once connected, every question you solve will be automatically tracked and I'll remind you to revise on Day 1, 3, and 7!`
  );
}

async function handleDoneAll(chatId) {
  const { data: user } = await supabase
    .from('users').select('id').eq('telegram_chat_id', chatId).single();
  if (!user) return;

  const today = new Date().toISOString().split('T')[0];

  await supabase
    .from('revisions')
    .update({ status: 'done', completed_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .eq('due_date', today)
    .eq('status', 'pending');

  await sendTelegram(chatId, '✅ All revisions for today marked as done! Great work!');
}

async function handleDoneSpecific(chatId, indices) {
  const { data: user } = await supabase
    .from('users').select('id').eq('telegram_chat_id', chatId).single();
  if (!user) return;

  const today = new Date().toISOString().split('T')[0];
  const { data: revisions } = await supabase
    .from('revisions')
    .select('id')
    .eq('user_id', user.id)
    .eq('due_date', today)
    .eq('status', 'pending')
    .order('created_at');

  const toMark = indices
    .filter(i => i >= 0 && i < revisions.length)
    .map(i => revisions[i].id);

  if (toMark.length === 0) {
    await sendTelegram(chatId, '❌ Invalid numbers. Use "done" to clear all or "done 1,2" for specific ones.');
    return;
  }

  await supabase
    .from('revisions')
    .update({ status: 'done', completed_at: new Date().toISOString() })
    .in('id', toMark);

  await sendTelegram(chatId, `✅ Marked ${toMark.length} revision(s) as done!`);
}

async function handleStatus(chatId) {
  const { data: user } = await supabase
    .from('users').select('id').eq('telegram_chat_id', chatId).single();
  if (!user) return;

  const today = new Date().toISOString().split('T')[0];
  const { data: revisions } = await supabase
    .from('revisions')
    .select('*, solved_questions(question_title, difficulty, topic)')
    .eq('user_id', user.id)
    .eq('due_date', today)
    .eq('status', 'pending');

  if (!revisions || revisions.length === 0) {
    await sendTelegram(chatId, '🎉 No pending revisions for today!');
    return;
  }

  let msg = `📚 <b>Pending revisions today:</b>\n\n`;
  revisions.forEach((r, i) => {
    const q = r.solved_questions;
    msg += `${i + 1}. ${q.question_title} (${q.topic}) — ${q.difficulty} [Day ${r.revision_day}]\n`;
  });
  msg += `\nReply "done" to clear all or "done 1,2" for specific ones.`;

  await sendTelegram(chatId, msg);
}

// ─── EXTENSION: Activate link code ────────────────────────────────────────────
// Called once when user enters their code in the extension
app.post('/api/activate', async (req, res) => {
  const { link_code } = req.body;
  if (!link_code) return res.status(400).json({ error: 'link_code required' });

  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('link_code', link_code.toUpperCase())
    .single();

  if (error || !user) return res.status(404).json({ error: 'Invalid link code' });
  if (user.link_code_used) return res.json({ success: true, already_activated: true });

  await supabase
    .from('users')
    .update({ link_code_used: true })
    .eq('id', user.id);

  res.json({ success: true, message: 'Extension linked successfully!' });
});

app.get('/health', (_, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
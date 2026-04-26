require('dotenv').config();
// cron/send-reminders.js
// Runs daily via GitHub Actions
// 1. Handles missed revisions from yesterday
// 2. Fetches today's due revisions per user
// 3. Sends Telegram messages

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const today = new Date().toISOString().split('T')[0];

async function main() {
  console.log(`[${today}] Starting daily reminder job...`);

  // Step 1: Handle missed revisions from yesterday
  await handleMissedRevisions();

  // Step 2: Get all users
  const { data: users, error } = await supabase.from('users').select('*');
  if (error) { console.error('Failed to fetch users:', error); return; }

  console.log(`Sending reminders to ${users.length} user(s)...`);

  // Step 3: Send reminders to each user
  for (const user of users) {
    await sendReminderToUser(user);
  }

  console.log('Done!');
}

async function handleMissedRevisions() {
  // Call the SQL function we created in schema.sql
  const { error } = await supabase.rpc('handle_missed_revisions');
  if (error) console.error('handle_missed_revisions error:', error);
  else console.log('Handled missed revisions from yesterday.');
}

async function sendReminderToUser(user) {
  // Get today's pending revisions for this user
  const { data: revisions, error } = await supabase
    .from('revisions')
    .select(`
      id, revision_day, is_carry_attempt,
      solved_questions (
        question_title, question_slug, question_url, difficulty, topic
      )
    `)
    .eq('user_id', user.id)
    .eq('due_date', today)
    .eq('status', 'pending')
    .order('is_carry_attempt', { ascending: true }) // fresh first, missed second
    .order('revision_day');

  if (error) { console.error(`Error for user ${user.id}:`, error); return; }
  if (!revisions || revisions.length === 0) {
    console.log(`No revisions due today for ${user.telegram_username || user.telegram_chat_id}`);
    return;
  }

  // Separate fresh vs carried (missed)
  const fresh = revisions.filter(r => !r.is_carry_attempt);
  const missed = revisions.filter(r => r.is_carry_attempt);

  // Build the message
  const dateStr = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long'
  });

  let msg = `📚 <b>DSA Revision — ${dateStr}</b>\n`;
  msg += `You have <b>${revisions.length}</b> question(s) to revise today.\n\n`;

  if (fresh.length > 0) {
    msg += `✅ <b>Due today:</b>\n`;
    fresh.forEach((r, i) => {
      const q = r.solved_questions;
      const link = q.question_url ? `<a href="${q.question_url}">${q.question_title}</a>` : q.question_title;
      msg += `  ${i + 1}. ${link} — ${q.difficulty} [Day ${r.revision_day}]\n`;
      if (q.topic) msg += `      📌 ${q.topic}\n`;
    });
    msg += '\n';
  }

  if (missed.length > 0) {
    msg += `⚠️ <b>Missed yesterday (last chance!):</b>\n`;
    missed.forEach((r, i) => {
      const q = r.solved_questions;
      const link = q.question_url ? `<a href="${q.question_url}">${q.question_title}</a>` : q.question_title;
      msg += `  ${fresh.length + i + 1}. ${link} — ${q.difficulty} [Day ${r.revision_day}]\n`;
    });
    msg += '\n';
  }

  msg += `Reply <b>"done"</b> when finished, or <b>"done 1,2"</b> for specific ones.\n`;
  msg += `Reply <b>/status</b> anytime to see pending revisions.`;

  // Send the Telegram message
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: user.telegram_chat_id,
          text: msg,
          parse_mode: 'HTML',
          disable_web_page_preview: false,
        }),
      }
    );

    const data = await res.json();
    if (data.ok) {
      console.log(`Sent reminder to ${user.telegram_username || user.telegram_chat_id} (${revisions.length} questions)`);

      // Log notification
      await supabase.from('notification_log').upsert({
        user_id: user.id,
        sent_date: today,
        revision_ids: revisions.map(r => r.id),
        message_sent: msg,
      }, { onConflict: 'user_id,sent_date' });

      // Mark as notified
      await supabase
        .from('revisions')
        .update({ notified_at: new Date().toISOString() })
        .in('id', revisions.map(r => r.id));

    } else {
      console.error(`Failed to send to ${user.telegram_chat_id}:`, data);
    }
  } catch (err) {
    console.error(`Telegram error for ${user.telegram_chat_id}:`, err);
  }
}

main().catch(console.error);
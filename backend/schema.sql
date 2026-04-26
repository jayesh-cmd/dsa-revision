-- DSA Revision Tracker — Supabase Schema
-- Run this entire file in Supabase SQL Editor

-- Users table (linked via Telegram)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_chat_id TEXT UNIQUE NOT NULL,
  telegram_username TEXT,
  link_code TEXT UNIQUE,                -- e.g. DSA-4829, used to link extension
  link_code_used BOOLEAN DEFAULT FALSE,
  reminder_time TEXT DEFAULT '08:00',   -- daily reminder time (HH:MM)
  timezone TEXT DEFAULT 'Asia/Kolkata',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Questions solved (logged by browser extension)
CREATE TABLE solved_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  question_title TEXT NOT NULL,
  question_slug TEXT,                   -- e.g. two-sum
  question_url TEXT,
  difficulty TEXT CHECK (difficulty IN ('Easy', 'Medium', 'Hard')),
  topic TEXT,                           -- e.g. Arrays, DP, Stack
  solved_at DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Revision schedule (auto-created after each solve)
CREATE TABLE revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  question_id UUID REFERENCES solved_questions(id) ON DELETE CASCADE,
  due_date DATE NOT NULL,
  revision_day INT CHECK (revision_day IN (1, 3, 7)), -- which slot: day1, day3, or day7
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'missed', 'carried')),
  carried_from DATE,                    -- if this was carried over from a missed day
  is_carry_attempt BOOLEAN DEFAULT FALSE, -- true = this is the one extra chance
  notified_at TIMESTAMPTZ,             -- when telegram message was sent
  completed_at TIMESTAMPTZ,            -- when user marked done
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Daily notification log (to avoid duplicate sends)
CREATE TABLE notification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  sent_date DATE DEFAULT CURRENT_DATE,
  revision_ids TEXT[],                  -- array of revision IDs included in this message
  message_sent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, sent_date)            -- one notification per user per day
);

-- Indexes for performance
CREATE INDEX idx_revisions_due_date ON revisions(due_date);
CREATE INDEX idx_revisions_user_status ON revisions(user_id, status);
CREATE INDEX idx_solved_user ON solved_questions(user_id);

-- Function: auto-create revision schedule when a question is solved
CREATE OR REPLACE FUNCTION create_revision_schedule()
RETURNS TRIGGER AS $$
BEGIN
  -- Day 1 revision
  INSERT INTO revisions (user_id, question_id, due_date, revision_day)
  VALUES (NEW.user_id, NEW.id, NEW.solved_at + INTERVAL '1 day', 1);

  -- Day 3 revision
  INSERT INTO revisions (user_id, question_id, due_date, revision_day)
  VALUES (NEW.user_id, NEW.id, NEW.solved_at + INTERVAL '3 days', 3);

  -- Day 7 revision
  INSERT INTO revisions (user_id, question_id, due_date, revision_day)
  VALUES (NEW.user_id, NEW.id, NEW.solved_at + INTERVAL '7 days', 7);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger to solved_questions
CREATE TRIGGER after_question_solved
AFTER INSERT ON solved_questions
FOR EACH ROW EXECUTE FUNCTION create_revision_schedule();

-- Function: handle missed revisions (called by cron before sending notifications)
-- Marks yesterday's pending as missed or carries them forward
CREATE OR REPLACE FUNCTION handle_missed_revisions()
RETURNS void AS $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT * FROM revisions
    WHERE due_date = CURRENT_DATE - INTERVAL '1 day'
      AND status = 'pending'
  LOOP
    IF r.is_carry_attempt THEN
      -- Already got one extra chance, now permanently missed
      UPDATE revisions SET status = 'missed' WHERE id = r.id;
    ELSE
      -- Give one extra chance: carry to today
      UPDATE revisions SET status = 'carried' WHERE id = r.id;
      INSERT INTO revisions (user_id, question_id, due_date, revision_day, status, carried_from, is_carry_attempt)
      VALUES (r.user_id, r.question_id, CURRENT_DATE, r.revision_day, 'pending', r.due_date, TRUE);
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;
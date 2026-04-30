# DSA Revision Tracker

Solve questions on LeetCode. Get reminded to revise them automatically on Telegram. Never forget a question again.

---

## Get started (3 steps, 2 mins)

### Step 1 — Install the extension
- Open Chrome → go to `chrome://extensions/`
- Enable **Developer Mode** (top right toggle)
- Click **Load Unpacked** → select the `extension/` folder

### Step 2 — Connect Telegram
- Open Telegram → search **@Dsa_byjey_bot** → send `/start`
- Bot replies with your personal code like `DSA-4829`

### Step 3 — Link the extension
- Click the extension icon in Chrome toolbar
- Paste your code → hit **Connect**

**Done. Just solve on LeetCode now — everything else is automatic.**

---

## How it works

You solve a question → extension logs it automatically → you get Telegram reminders on Day 1, Day 3, and Day 7.

```
Solve Two Sum on April 27
→ Reminder April 28  (Day 1)
→ Reminder April 30  (Day 3)
→ Reminder May 4     (Day 7)
```

Every morning at 8am the bot sends only the questions due that day. After Day 7 the question is done — never sent again.

---

## If you miss a day

The question carries forward once with a ⚠️ tag. Miss it again → marked as missed permanently. The next scheduled revision still fires normally.

---

## Telegram commands

| Message | What happens |
|---|---|
| `/start` | Register and get your link code |
| `done` | Mark all today's revisions complete |
| `done 1,3` | Mark specific questions complete |
| `/status` | See what's still pending today |

---

## Common issues

**Bot not replying** — send `/start` again after a few seconds, the server may have been sleeping.

**Extension not detecting submission** — make sure you're on the actual submission result page showing "Accepted" and the extension is enabled in `chrome://extensions/`.

---

## For self-hosting

If you want to run your own instance of this project, check `SELF_HOSTING.md`.
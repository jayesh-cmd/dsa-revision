// content.js — runs on leetcode.com pages
// Watches for "Accepted" submission result and sends to our backend

const API_BASE = 'https://b663-2409-40c4-4e-736b-fded-7253-27e-e157.ngrok-free.app'; // replace after deploy

let lastLoggedSlug = null;
let lastLoggedDate = null;

// Watch DOM for the accepted result appearing
const observer = new MutationObserver(() => {
  checkForAccepted();
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
});

// Also check on initial load
checkForAccepted();

function checkForAccepted() {
  // LeetCode shows a result panel after submission
  // Look for the "Accepted" text in the result area
  const resultElements = document.querySelectorAll('[data-e2e-locator="submission-result"]');

  for (const el of resultElements) {
    if (el.textContent.trim() === 'Accepted') {
      captureAndLog();
      break;
    }
  }

  // Fallback: check page title which also shows "Accepted"
  if (document.title.includes('Accepted')) {
    captureAndLog();
  }
}

function captureAndLog() {
  const slug = getQuestionSlug();
  const today = new Date().toISOString().split('T')[0];

  // Avoid duplicate sends for same question same day
  if (slug === lastLoggedSlug && today === lastLoggedDate) return;

  const questionData = extractQuestionData();
  if (!questionData) return;

  lastLoggedSlug = slug;
  lastLoggedDate = today;

  sendToBackend(questionData);
}

function getQuestionSlug() {
  // URL is like: leetcode.com/problems/two-sum/
  const match = window.location.pathname.match(/\/problems\/([^/]+)/);
  return match ? match[1] : null;
}

function extractQuestionData() {
  const slug = getQuestionSlug();
  if (!slug) return null;

  // Question title — appears in the page heading
  const titleEl = document.querySelector('[data-cy="question-title"]')
    || document.querySelector('.text-title-large')
    || document.querySelector('title');

  let title = titleEl?.textContent?.trim() || '';

  // Clean up title (remove "- LeetCode" suffix if from <title>)
  title = title.replace(/\s*-\s*LeetCode.*$/i, '').trim();

  // Difficulty — look for the difficulty badge
  const diffEl = document.querySelector('[diff]')
    || document.querySelector('.text-difficulty-easy, .text-difficulty-medium, .text-difficulty-hard');

  let difficulty = 'Medium';
  if (diffEl) {
    const txt = diffEl.textContent.trim();
    if (txt.includes('Easy')) difficulty = 'Easy';
    else if (txt.includes('Hard')) difficulty = 'Hard';
    else difficulty = 'Medium';
  }

  // Topic — from the URL tags or page tags
  const topicEl = document.querySelector('[href*="/tag/"]');
  const topic = topicEl?.textContent?.trim() || guessTopicFromSlug(slug);

  return {
    question_title: title || formatSlug(slug),
    question_slug: slug,
    question_url: `https://leetcode.com/problems/${slug}/`,
    difficulty,
    topic,
  };
}

function formatSlug(slug) {
  // "two-sum" → "Two Sum"
  return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function guessTopicFromSlug(slug) {
  // Basic heuristic if topic tags aren't visible
  const hints = {
    'tree': 'Trees', 'binary': 'Binary Search', 'linked': 'Linked List',
    'stack': 'Stack', 'queue': 'Queue', 'graph': 'Graphs',
    'dp': 'Dynamic Programming', 'sort': 'Sorting', 'string': 'Strings',
    'array': 'Arrays', 'hash': 'Hash Map', 'heap': 'Heap',
  };
  for (const [key, val] of Object.entries(hints)) {
    if (slug.includes(key)) return val;
  }
  return 'General';
}

async function sendToBackend(questionData) {
  // Get link code from extension storage
  const result = await chrome.storage.sync.get(['linkCode']);
  const linkCode = result.linkCode;

  if (!linkCode) {
    console.warn('[DSA Tracker] No link code set. Open the extension popup to configure.');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/solved`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Link-Code': linkCode,
      },
      body: JSON.stringify(questionData),
    });

    const data = await res.json();

    if (data.duplicate) {
      console.log('[DSA Tracker] Already logged today:', questionData.question_title);
      return;
    }

    if (data.success) {
      console.log('[DSA Tracker] Logged:', questionData.question_title);
      showToast(`✅ Logged for revision: ${questionData.question_title}`);
    }
  } catch (err) {
    console.error('[DSA Tracker] Failed to log:', err);
  }
}

function showToast(message) {
  // Show a small non-intrusive toast on LeetCode page
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    background: #1a1a2e;
    color: #fff;
    padding: 12px 20px;
    border-radius: 8px;
    font-size: 14px;
    font-family: sans-serif;
    z-index: 999999;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    animation: fadeIn 0.3s ease;
  `;

  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}
/**
 * reader.js — Mark-as-read with GitHub Gist cross-device sync
 *
 * localStorage keys:
 *   rss_gist_id  — GitHub Gist ID for read state storage
 *   rss_gist_pat — GitHub Personal Access Token (gist scope)
 *   rss_read_ids — JSON array of read article IDs (local cache)
 *
 * To migrate to a PHP backend later: replace fetchRemoteState() and
 * saveRemoteState() to call your own API endpoint instead of Gist.
 */

const GIST_ID_KEY   = 'rss_gist_id';
const PAT_KEY       = 'rss_gist_pat';
const LOCAL_KEY     = 'rss_read_ids';
const GIST_FILENAME = 'read-state.json';

// ── State ────────────────────────────────────────────────────────────────────

let readIds  = new Set(JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'));
let syncTimer = null;

// ── Local state helpers ───────────────────────────────────────────────────────

function saveLocal() {
  localStorage.setItem(LOCAL_KEY, JSON.stringify([...readIds]));
}

function applyReadState() {
  document.querySelectorAll('[data-article-id]').forEach(el => {
    el.classList.toggle('is-read', readIds.has(el.dataset.articleId));
  });
  updateUnreadCount();
}

function updateUnreadCount() {
  const total  = document.querySelectorAll('[data-article-id]').length;
  const unread = total - document.querySelectorAll('[data-article-id].is-read').length;
  const el = document.getElementById('js-unread-count');
  if (el) el.textContent = unread > 0 ? `${unread} unread` : 'all read';
}

// ── Mark read actions ─────────────────────────────────────────────────────────

function markRead(id) {
  readIds.add(id);
  saveLocal();
  applyReadState();
  debouncedSyncToGist();
}

function markAllRead() {
  document.querySelectorAll('[data-article-id]').forEach(el => {
    readIds.add(el.dataset.articleId);
  });
  saveLocal();
  applyReadState();
  syncToGist();
}

// ── Gist API ──────────────────────────────────────────────────────────────────

function getCredentials() {
  return {
    pat:    localStorage.getItem(PAT_KEY),
    gistId: localStorage.getItem(GIST_ID_KEY),
  };
}

async function fetchRemoteState() {
  const { pat, gistId } = getCredentials();
  if (!pat || !gistId) return null;

  const res = await fetch(`https://api.github.com/gists/${gistId}`, {
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: 'application/vnd.github+json',
    },
  });

  if (!res.ok) throw new Error(`Gist fetch failed: ${res.status}`);

  const data    = await res.json();
  const content = data.files?.[GIST_FILENAME]?.content;
  return content ? JSON.parse(content) : null;
}

async function saveRemoteState(state) {
  const { pat, gistId } = getCredentials();
  if (!pat || !gistId) return;

  const res = await fetch(`https://api.github.com/gists/${gistId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      files: {
        [GIST_FILENAME]: {
          content: JSON.stringify(state, null, 2),
        },
      },
    }),
  });

  if (!res.ok) throw new Error(`Gist save failed: ${res.status}`);
}

async function createGist(pat) {
  const initialState = { readIds: [], updatedAt: new Date().toISOString() };
  const res = await fetch('https://api.github.com/gists', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      description: 'Bryan RSS — read state',
      public: false,
      files: {
        [GIST_FILENAME]: {
          content: JSON.stringify(initialState, null, 2),
        },
      },
    }),
  });

  if (!res.ok) throw new Error(`Gist create failed: ${res.status}`);
  const data = await res.json();
  return data.id;
}

// ── Sync ──────────────────────────────────────────────────────────────────────

async function syncFromGist() {
  try {
    setSyncStatus('Syncing...');
    const remote = await fetchRemoteState();
    if (remote?.readIds?.length) {
      // Merge: union of local and remote (read state is append-only)
      remote.readIds.forEach(id => readIds.add(id));
      saveLocal();
      applyReadState();
    }
    setSyncStatus('Synced ✓');
    setTimeout(() => setSyncStatus(syncLabel()), 3000);
  } catch (err) {
    setSyncStatus('Sync error');
    console.error('Gist sync error:', err);
  }
}

async function syncToGist() {
  const { pat, gistId } = getCredentials();
  if (!pat || !gistId) return;

  try {
    const state = {
      readIds: [...readIds],
      updatedAt: new Date().toISOString(),
    };
    await saveRemoteState(state);
  } catch (err) {
    console.error('Gist write error:', err);
  }
}

function debouncedSyncToGist() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncToGist, 1500);
}

// ── Setup sync ────────────────────────────────────────────────────────────────

async function setupSync() {
  const pat = prompt(
    'Enter your GitHub Personal Access Token\n' +
    '(create one at github.com/settings/tokens — needs "gist" scope only)'
  );
  if (!pat?.trim()) return;

  let gistId = prompt(
    'Enter your Gist ID\n' +
    '(leave blank to automatically create a new private Gist)'
  );

  if (!gistId?.trim()) {
    try {
      setSyncStatus('Creating Gist...');
      gistId = await createGist(pat.trim());
      alert(
        `Gist created successfully!\n\nGist ID: ${gistId}\n\n` +
        'Save this ID — you\'ll need it when setting up sync on other devices.'
      );
    } catch (err) {
      alert('Failed to create Gist. Check your token has "gist" scope and try again.');
      setSyncStatus(syncLabel());
      return;
    }
  }

  localStorage.setItem(PAT_KEY, pat.trim());
  localStorage.setItem(GIST_ID_KEY, gistId.trim());

  await syncFromGist();
}

// ── Hide/show read toggle ─────────────────────────────────────────────────────

let hideReadActive = false;

function toggleHideRead() {
  hideReadActive = !hideReadActive;
  document.body.classList.toggle('hide-read', hideReadActive);
  const btn = document.getElementById('js-toggle-hide-read');
  if (btn) btn.textContent = hideReadActive ? 'Show read' : 'Hide read';
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function setSyncStatus(msg) {
  const el = document.getElementById('js-sync-status');
  if (el) el.textContent = msg;
}

function syncLabel() {
  const { pat, gistId } = getCredentials();
  return pat && gistId ? 'Sync: on' : 'Sync: off';
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Apply local read state immediately
  applyReadState();
  setSyncStatus(syncLabel());

  // Sync from Gist on load if credentials are present
  const { pat, gistId } = getCredentials();
  if (pat && gistId) syncFromGist();

  // Header toolbar buttons
  document.getElementById('js-mark-all-read')?.addEventListener('click', markAllRead);
  document.getElementById('js-setup-sync')?.addEventListener('click', setupSync);
  document.getElementById('js-toggle-hide-read')?.addEventListener('click', toggleHideRead);

  // Per-article mark-read buttons (event delegation on document)
  document.addEventListener('click', e => {
    const btn = e.target.closest('.js-mark-read');
    if (btn) markRead(btn.dataset.id);
  });
});

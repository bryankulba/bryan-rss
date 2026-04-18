/**
 * reader.js — Mark-as-read + Favourites with GitHub Gist cross-device sync
 *
 * localStorage keys:
 *   rss_gist_id    — GitHub Gist ID for read state storage
 *   rss_gist_pat   — GitHub Personal Access Token (gist scope)
 *   rss_read_ids   — JSON array of read article IDs (local cache)
 *   rss_fav_ids    — JSON array of favourited article IDs (local cache, derived from rss_fav_data)
 *   rss_fav_data   — JSON object map of rich favourite data keyed by article ID
 *   rss_hide_read  — boolean: hide read items
 *   rss_show_favs  — boolean: show only favourites
 *
 * Gist schema (read-state.json):
 *   { readIds: [...], favouriteIds: [...], favouriteData: {...}, updatedAt: "..." }
 *
 * To migrate to a PHP backend later: replace fetchRemoteState() and
 * saveRemoteState() to call your own API endpoint instead of Gist.
 */

const GIST_ID_KEY    = 'rss_gist_id';
const PAT_KEY        = 'rss_gist_pat';
const LOCAL_KEY      = 'rss_read_ids';
const FAV_KEY        = 'rss_fav_ids';
const FAV_DATA_KEY   = 'rss_fav_data';
const HIDE_READ_KEY  = 'rss_hide_read';
const SHOW_FAVS_KEY  = 'rss_show_favs';
const GIST_FILENAME  = 'read-state.json';

// ── State ────────────────────────────────────────────────────────────────────

let readIds       = new Set(JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'));
let favouriteData = JSON.parse(localStorage.getItem(FAV_DATA_KEY) || '{}');
let syncTimer     = null;

// Migrate old rss_fav_ids (plain array) into favouriteData if not already present
(function migrateLegacyFavIds() {
  const legacy = JSON.parse(localStorage.getItem(FAV_KEY) || '[]');
  let migrated = false;
  legacy.forEach(id => {
    if (!favouriteData[id]) {
      favouriteData[id] = { id, favouritedAt: null, postDate: null, note: '', tags: [] };
      migrated = true;
    }
  });
  if (migrated) localStorage.setItem(FAV_DATA_KEY, JSON.stringify(favouriteData));
})();

// Derived Set — always kept in sync with favouriteData
function getFavouriteIds() {
  return new Set(Object.keys(favouriteData));
}

// ── Local state helpers ───────────────────────────────────────────────────────

function saveLocal() {
  localStorage.setItem(LOCAL_KEY, JSON.stringify([...readIds]));
  localStorage.setItem(FAV_DATA_KEY, JSON.stringify(favouriteData));
  // Keep rss_fav_ids in sync for backward compatibility
  localStorage.setItem(FAV_KEY, JSON.stringify(Object.keys(favouriteData)));
}

function applyReadState() {
  document.querySelectorAll('[data-article-id]').forEach(el => {
    el.classList.toggle('is-read', readIds.has(el.dataset.articleId));
  });
  updateUnreadCount();
}

function applyFavouriteState() {
  const favIds = getFavouriteIds();
  document.querySelectorAll('[data-article-id]').forEach(el => {
    const isFav = favIds.has(el.dataset.articleId);
    el.classList.toggle('is-favourite', isFav);
    const btn = el.querySelector('.js-favourite');
    if (btn) btn.textContent = isFav ? '★' : '☆';

    // Update annotation (note + tags)
    el.querySelector('.fav-annotation')?.remove();
    if (isFav) {
      const data = favouriteData[el.dataset.articleId];
      if (data) el.appendChild(buildFavAnnotation(el.dataset.articleId, data));
    }
  });
}

function buildFavAnnotation(id, data) {
  const div = document.createElement('div');
  div.className = 'fav-annotation';

  const hasContent = data.note || data.tags?.length;

  if (hasContent) {
    const row = document.createElement('div');
    row.className = 'fav-annotation__note-row';

    if (data.note) {
      const note = document.createElement('p');
      note.className = 'fav-annotation__note';
      note.textContent = data.note;
      row.appendChild(note);
    }

    const editBtn = document.createElement('button');
    editBtn.className = 'js-fav-edit btn fav-annotation__edit-btn';
    editBtn.dataset.id = id;
    editBtn.title = 'Edit note';
    editBtn.textContent = '✏';
    row.appendChild(editBtn);

    div.appendChild(row);

    if (data.tags?.length) {
      const tagsEl = document.createElement('div');
      tagsEl.className = 'fav-annotation__tags';
      tagsEl.style.marginTop = 'var(--token-spacing-xs)';
      data.tags.forEach(tag => {
        const span = document.createElement('span');
        span.className = 'fav-tag';
        span.textContent = tag;
        tagsEl.appendChild(span);
      });
      div.appendChild(tagsEl);
    }
  } else {
    const addBtn = document.createElement('button');
    addBtn.className = 'js-fav-add-note btn fav-annotation__add-btn';
    addBtn.dataset.id = id;
    addBtn.textContent = '+ Add note';
    div.appendChild(addBtn);
  }

  return div;
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

// ── Favourite actions ─────────────────────────────────────────────────────────

function toggleFavourite(id) {
  // Already favourited — do nothing (removal handled in a future dedicated view)
  if (favouriteData[id]) return;
  showFavouriteDialog(id);
}

function saveFavourite(id, note, tags, postDate) {
  const existing = favouriteData[id];
  favouriteData[id] = {
    id,
    favouritedAt: existing?.favouritedAt || new Date().toISOString(),
    postDate: existing?.postDate || postDate || null,
    note: note.trim(),
    tags: tags.map(t => t.trim()).filter(Boolean),
  };
  readIds.add(id);
  saveLocal();
  applyReadState();
  applyFavouriteState();
  debouncedSyncToGist();
}

// ── Favourite dialog ──────────────────────────────────────────────────────────

let pendingFavId = null;

function injectFavouriteDialog() {
  const dialog = document.createElement('dialog');
  dialog.id = 'js-fav-dialog';
  dialog.innerHTML = `
    <p class="fav-dialog__article-title" id="js-fav-dialog-title"></p>
    <label class="fav-dialog__label">
      Note
      <textarea id="js-fav-note" rows="3" placeholder="What struck you about this?"></textarea>
    </label>
    <label class="fav-dialog__label">
      Tags
      <input id="js-fav-tags" type="text" placeholder="comma-separated  e.g. ai, design">
    </label>
    <div class="fav-dialog__actions">
      <button id="js-fav-cancel" class="btn btn--ghost">Cancel</button>
      <button id="js-fav-save" class="btn btn--primary">Save favourite</button>
    </div>
  `;
  document.body.appendChild(dialog);

  dialog.addEventListener('click', e => {
    if (e.target === dialog) closeFavouriteDialog();
  });

  document.getElementById('js-fav-cancel').addEventListener('click', closeFavouriteDialog);

  document.getElementById('js-fav-save').addEventListener('click', () => {
    if (!pendingFavId) return;
    const note = document.getElementById('js-fav-note').value;
    const tagsRaw = document.getElementById('js-fav-tags').value;
    const tags = tagsRaw.split(',');
    saveFavourite(pendingFavId, note, tags, pendingFavPostDate);
    closeFavouriteDialog();
  });

  // Allow Escape key to cancel
  dialog.addEventListener('cancel', closeFavouriteDialog);
}

let pendingFavPostDate = null;

function showFavouriteDialog(id, isEdit = false) {
  const articleEl = document.querySelector(`[data-article-id="${id}"]`);
  const title = articleEl?.querySelector('.feed-item__title a')?.textContent?.trim() || '';
  const postDate = articleEl?.querySelector('time[datetime]')?.getAttribute('datetime') || null;

  pendingFavId = id;
  pendingFavPostDate = postDate;

  const dialog = document.getElementById('js-fav-dialog');
  const titleEl = document.getElementById('js-fav-dialog-title');
  const noteEl = document.getElementById('js-fav-note');
  const tagsEl = document.getElementById('js-fav-tags');
  const saveBtn = document.getElementById('js-fav-save');

  if (titleEl) titleEl.textContent = title;
  if (saveBtn) saveBtn.textContent = isEdit ? 'Update' : 'Save favourite';

  const existing = favouriteData[id];
  if (noteEl) noteEl.value = isEdit && existing ? (existing.note || '') : '';
  if (tagsEl) tagsEl.value = isEdit && existing ? (existing.tags || []).join(', ') : '';

  dialog.showModal();
  noteEl?.focus();
}

function closeFavouriteDialog() {
  pendingFavId = null;
  pendingFavPostDate = null;
  document.getElementById('js-fav-dialog')?.close();
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
  const initialState = { readIds: [], favouriteIds: [], favouriteData: {}, updatedAt: new Date().toISOString() };
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
    if (remote) {
      // Merge readIds: union
      remote.readIds?.forEach(id => readIds.add(id));
      // Merge favouriteData: union by ID (remote wins on conflict)
      if (remote.favouriteData) {
        favouriteData = { ...remote.favouriteData, ...favouriteData };
      } else if (remote.favouriteIds) {
        // Backward compat: remote only has IDs, no rich data — seed entries without metadata
        remote.favouriteIds.forEach(id => {
          if (!favouriteData[id]) {
            favouriteData[id] = { id, favouritedAt: null, postDate: null, note: '', tags: [] };
          }
        });
      }
      saveLocal();
      applyReadState();
      applyFavouriteState();
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
      readIds:       [...readIds],
      favouriteIds:  Object.keys(favouriteData),
      favouriteData,
      updatedAt:     new Date().toISOString(),
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

// ── Archive toggle ────────────────────────────────────────────────────────────

let archiveActive = localStorage.getItem(HIDE_READ_KEY) === 'true';

function toggleArchive() {
  archiveActive = !archiveActive;
  localStorage.setItem(HIDE_READ_KEY, archiveActive);
  applyArchive();
}

function applyArchive() {
  document.body.classList.toggle('archive', archiveActive);
  const btn = document.getElementById('js-toggle-archive');
  if (btn) btn.classList.toggle('btn--active', archiveActive);
}

// ── Search ────────────────────────────────────────────────────────────────────

function toggleSearch() {
  const shim = document.getElementById('js-search-shim');
  const input = document.getElementById('js-search-input');
  const btn = document.getElementById('js-toggle-search');
  const isOpen = !shim.hidden;
  shim.hidden = isOpen;
  if (btn) btn.classList.toggle('btn--active', !isOpen);
  if (isOpen) {
    input.value = '';
    applySearch('');
  } else {
    input.focus();
  }
}

function applySearch(query) {
  const q = query.trim().toLowerCase();
  document.querySelectorAll('[data-article-id]').forEach(el => {
    if (!q) {
      el.classList.remove('search-hidden');
      el.classList.remove('search-match');
      return;
    }
    const title = el.querySelector('.feed-item__title')?.textContent?.toLowerCase() || '';
    const desc  = el.querySelector('.feed-item__desc')?.textContent?.toLowerCase()  || '';
    const matches = title.includes(q) || desc.includes(q);
    el.classList.toggle('search-hidden', !matches);
    el.classList.toggle('search-match', matches);
  });
}

// ── Show favourites toggle ────────────────────────────────────────────────────

let showFavsActive = localStorage.getItem(SHOW_FAVS_KEY) === 'true';

function toggleShowFavourites() {
  showFavsActive = !showFavsActive;
  localStorage.setItem(SHOW_FAVS_KEY, showFavsActive);
  applyShowFavourites();
}

function applyShowFavourites() {
  document.body.classList.toggle('show-favourites', showFavsActive);
  const btn = document.getElementById('js-toggle-show-favourites');
  if (btn) btn.classList.toggle('btn--active', showFavsActive);
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
  injectFavouriteDialog();

  applyReadState();
  applyFavouriteState();
  applyArchive();
  applyShowFavourites();

  // Sync from Gist on load if credentials are present; swap setup button for sync button
  const { pat, gistId } = getCredentials();
  if (pat && gistId) {
    syncFromGist();
    document.getElementById('js-setup-sync')?.remove();
    const syncNowBtn = document.getElementById('js-sync-now');
    if (syncNowBtn) syncNowBtn.style.display = '';
  }

  // Header toolbar buttons
  document.getElementById('js-mark-all-read')?.addEventListener('click', markAllRead);
  document.getElementById('js-setup-sync')?.addEventListener('click', setupSync);
  document.getElementById('js-sync-now')?.addEventListener('click', syncFromGist);
  document.getElementById('js-toggle-archive')?.addEventListener('click', toggleArchive);
  document.getElementById('js-toggle-show-favourites')?.addEventListener('click', toggleShowFavourites);
  document.getElementById('js-toggle-search')?.addEventListener('click', toggleSearch);
  document.getElementById('js-search-input')?.addEventListener('input', e => applySearch(e.target.value));

  // Per-article buttons (event delegation)
  document.addEventListener('click', e => {
    const readBtn = e.target.closest('.js-mark-read');
    if (readBtn) markRead(readBtn.dataset.id);

    const favBtn = e.target.closest('.js-favourite');
    if (favBtn) toggleFavourite(favBtn.dataset.id);

    const editBtn = e.target.closest('.js-fav-edit');
    if (editBtn) showFavouriteDialog(editBtn.dataset.id, true);

    const addNoteBtn = e.target.closest('.js-fav-add-note');
    if (addNoteBtn) showFavouriteDialog(addNoteBtn.dataset.id, true);
  });
});

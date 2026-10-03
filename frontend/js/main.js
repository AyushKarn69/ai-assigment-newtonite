// App entry: session bootstrap and hash-based routing.
//
//   #/login                 sign in
//   #/dashboard             operational command
//   #/work-items[?filters]  list
//   #/work-items/:id        detail

import { api, session, setUnauthorizedHandler } from './api.js';
import { parseQueryString } from './lib/presets.js';
import { clearSession, loadSession, state } from './store.js';
import { errorState } from './states.js';
import { mountDashboard } from './views/dashboard.js';
import { mountDetail } from './views/detail.js';
import { mountShell } from './views/layout.js';
import { mountLogin } from './views/login.js';
import { openNewItemModal } from './views/newItem.js';
import { mountWorkItems } from './views/workItems.js';

const root = document.getElementById('app');

let shell = null; // handles from mountShell while signed in
let leaveView = null; // cleanup for the current view
let returnTo = null; // where to go after signing in
let notice = null; // message to show on the login screen

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, queryString = ''] = raw.split('?');
  return { segments: path.split('/').filter(Boolean), query: parseQueryString(queryString) };
}

function teardownShell() {
  shell?.destroy();
  shell = null;
}

function showLogin() {
  leaveView?.();
  leaveView = null;
  teardownShell();
  document.title = 'Sign in · Newtonite Ops';
  const message = notice;
  notice = null;
  leaveView = mountLogin(root, {
    notice: message,
    onSignedIn: async () => {
      await loadSession();
      const target = returnTo && !returnTo.startsWith('#/login') ? returnTo : '#/dashboard';
      returnTo = null;
      if (location.hash === target) route();
      else location.hash = target;
    },
  });
}

function signOutLocally(message) {
  session.clear();
  clearSession();
  notice = message ?? null;
  if (!location.hash.startsWith('#/login')) returnTo = location.hash;
  // changing the hash fires `hashchange`, which renders the login screen
  if (location.hash === '#/login') route();
  else location.hash = '#/login';
}

async function signOut() {
  try {
    await api('POST', '/auth/logout');
  } catch {
    /* the token may already be invalid; signing out locally is what matters */
  }
  returnTo = null;
  signOutLocally('You have been signed out.');
}

function ensureShell() {
  if (shell) return;
  shell = mountShell(root, {
    onSignOut: signOut,
    onNewItem: () => openNewItemModal(),
  });
}

function route() {
  leaveView?.();
  leaveView = null;

  if (!state.user) {
    if (!location.hash.startsWith('#/login')) {
      returnTo = location.hash && location.hash !== '#/' ? location.hash : null;
      history.replaceState(null, '', '#/login');
    }
    showLogin();
    return;
  }

  const { segments, query } = parseHash();
  const [name, id] = segments;

  if (!name || name === 'login') {
    location.hash = '#/dashboard';
    return;
  }

  ensureShell();
  // Every view gets a fresh element, so event listeners a previous view attached to its
  // container are discarded with it instead of piling up on a shared one.
  const view = document.createElement('div');
  shell.view.replaceChildren(view);

  switch (name) {
    case 'dashboard':
      document.title = 'Operational Command · Newtonite Ops';
      shell.setActive('dashboard');
      leaveView = mountDashboard(view);
      break;
    case 'work-items':
      shell.setActive('work-items');
      if (id) {
        document.title = 'Work Item · Newtonite Ops';
        leaveView = mountDetail(view, { id });
      } else {
        document.title = 'Work Items · Newtonite Ops';
        leaveView = mountWorkItems(view, { query, onNewItem: (teamId) => openNewItemModal({ defaultTeamId: teamId }) });
      }
      break;
    default:
      document.title = 'Not found · Newtonite Ops';
      shell.setActive(null);
      view.innerHTML = `<div class="px-8 py-10">${errorState({ status: 404, message: 'That page does not exist.' }, { backHref: '#/dashboard', backLabel: 'Go to Dashboard', title: 'Page Not Found' })}</div>`;
  }
  window.scrollTo(0, 0);
}

async function boot() {
  setUnauthorizedHandler(() => {
    if (state.user) signOutLocally('Your session has ended. Please sign in again.');
  });
  window.addEventListener('hashchange', route);

  if (session.token) {
    try {
      await loadSession();
    } catch {
      session.clear();
      clearSession();
    }
  }
  route();
}

boot();

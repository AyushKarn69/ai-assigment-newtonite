// Sign-in screen.

import { api, checkHealth, session } from '../api.js';
import { esc, formatDuration } from '../lib/format.js';
import { icon, fieldClasses, labelClasses, primaryButton } from '../ui.js';

/**
 * @param container  element to render into
 * @param ctx        { onSignedIn(), notice }  notice: optional message (e.g. session expired)
 */
export function mountLogin(container, { onSignedIn, notice } = {}) {
  container.innerHTML = `
    <div class="min-h-screen flex items-center justify-center px-4 py-10 bg-background">
      <div class="w-full max-w-md">
        <div class="bg-surface-container-lowest rounded-xl p-8 shadow-[0_2px_16px_rgba(58,48,42,0.06)] relative overflow-hidden">
          <div class="absolute -top-16 -right-16 w-44 h-44 rounded-full bg-surface-container-low"></div>
          <div class="relative">
            <div class="flex items-center gap-3">
              <div class="w-9 h-9 rounded-lg bg-primary flex items-center justify-center text-on-primary font-headline font-bold text-lg">N</div>
              <span class="font-headline text-xl font-semibold tracking-tight">Newtonite Ops</span>
            </div>
            <h1 class="mt-9 font-headline text-3xl font-semibold tracking-tight">Sign in</h1>
            <p class="mt-2 text-sm text-on-surface-variant leading-relaxed">Use your work email and password to open the operations workspace.</p>

            <div id="login-banner" class="${notice ? '' : 'hidden'} mt-5 rounded-lg px-3.5 py-2.5 text-xs bg-primary-fixed text-on-primary-fixed-variant" role="status">${esc(notice ?? '')}</div>
            <div id="login-error" class="hidden mt-5 rounded-lg px-3.5 py-2.5 text-xs bg-error-container text-on-error-container" role="alert"></div>

            <form id="login-form" class="mt-6 space-y-4" novalidate>
              <div>
                <label class="${labelClasses}" for="email">Email</label>
                <input id="email" name="email" type="email" autocomplete="username" required class="${fieldClasses}" placeholder="you@company.com" />
              </div>
              <div>
                <label class="${labelClasses}" for="password">Password</label>
                <div class="relative">
                  <input id="password" name="password" type="password" autocomplete="current-password" required class="${fieldClasses} pr-10" />
                  <button type="button" id="toggle-password" class="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-secondary hover:text-on-surface" aria-label="Show password">${icon('visibility', 'text-[18px]')}</button>
                </div>
              </div>
              <button id="login-submit" type="submit" class="${primaryButton} w-full h-10 text-sm">Sign in${icon('arrow_forward', 'text-[16px]')}</button>
            </form>

            <p class="mt-6 text-xs text-on-surface-variant">New here? <a href="#/register" class="font-semibold text-primary hover:underline">Create an account</a></p>
            <div class="mt-4 flex items-center justify-between text-[11px] text-secondary">
              <span id="auth-health" class="flex items-center gap-1.5"><span class="w-1.5 h-1.5 rounded-full bg-outline"></span>Checking service…</span>
            </div>
          </div>
        </div>
      </div>
    </div>`;

  const form = container.querySelector('#login-form');
  const errorBox = container.querySelector('#login-error');
  const submit = container.querySelector('#login-submit');
  const emailInput = container.querySelector('#email');
  const passwordInput = container.querySelector('#password');
  let countdownTimer = null;

  const showError = (message) => {
    errorBox.textContent = message;
    errorBox.classList.remove('hidden');
  };
  const clearError = () => {
    clearInterval(countdownTimer);
    errorBox.classList.add('hidden');
  };

  container.querySelector('#toggle-password').addEventListener('click', () => {
    const hidden = passwordInput.type === 'password';
    passwordInput.type = hidden ? 'text' : 'password';
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearError();
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (!email || !password) {
      showError('Enter your email and password.');
      return;
    }

    submit.disabled = true;
    submit.textContent = 'Signing in…';
    try {
      const { data } = await api('POST', '/auth/login', { body: { email, password }, auth: false });
      session.set(data.token);
      await onSignedIn();
    } catch (error) {
      submit.disabled = false;
      submit.innerHTML = `Sign in${icon('arrow_forward', 'text-[16px]')}`;
      passwordInput.value = '';
      if (error.code === 'INVALID_CREDENTIALS') {
        showError('That email and password do not match. Check them and try again.');
      } else if (error.code === 'ACCOUNT_DISABLED') {
        showError('This account has been disabled. Contact an administrator.');
      } else if (error.status === 429) {
        startCountdown(error.retryAfter ?? 60);
      } else if (error.code === 'VALIDATION_ERROR') {
        showError('Enter a valid email address and your password.');
      } else {
        showError(error.message);
      }
      passwordInput.focus();
    }
  });

  function startCountdown(seconds) {
    let remaining = seconds;
    const tick = () => {
      if (remaining <= 0) {
        clearError();
        return;
      }
      showError(`Too many failed sign-in attempts. Try again in ${formatDuration(remaining)}.`);
      remaining -= 1;
    };
    tick();
    countdownTimer = setInterval(tick, 1000);
  }

  checkHealth().then((health) => {
    const el = container.querySelector('#auth-health');
    if (!el) return;
    el.innerHTML = health.ok
      ? '<span class="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>Service healthy'
      : '<span class="w-1.5 h-1.5 rounded-full bg-error"></span>Service unreachable';
  });

  emailInput.focus();
  return () => clearInterval(countdownTimer);
}

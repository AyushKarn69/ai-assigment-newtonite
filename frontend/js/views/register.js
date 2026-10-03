// Create-an-account screen.

import { api, checkHealth, session } from '../api.js';
import { esc, formatDuration } from '../lib/format.js';
import { passwordStrength, validateRegistration } from '../lib/validation.js';
import { icon, fieldClasses, labelClasses, primaryButton } from '../ui.js';

const FIELDS = ['name', 'email', 'password', 'confirm'];

/** @param ctx  { onSignedIn() } called after the account is created and the token stored */
export function mountRegister(container, { onSignedIn } = {}) {
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
            <h1 class="mt-9 font-headline text-3xl font-semibold tracking-tight">Create your account</h1>
            <p class="mt-2 text-sm text-on-surface-variant leading-relaxed">You will be signed in straight away. A team manager then adds you to your team so you can see its work.</p>

            <div id="reg-error" class="hidden mt-5 rounded-lg px-3.5 py-2.5 text-xs bg-error-container text-on-error-container" role="alert"></div>

            <form id="reg-form" class="mt-6 space-y-4" novalidate>
              <div>
                <label class="${labelClasses}" for="reg-name">Full name</label>
                <input id="reg-name" name="name" autocomplete="name" maxlength="100" class="${fieldClasses}" />
                <p class="mt-1 text-[11px] text-error hidden" data-error-for="name"></p>
              </div>
              <div>
                <label class="${labelClasses}" for="reg-email">Work email</label>
                <input id="reg-email" name="email" type="email" autocomplete="username" class="${fieldClasses}" placeholder="you@company.com" />
                <p class="mt-1 text-[11px] text-error hidden" data-error-for="email"></p>
              </div>
              <div>
                <label class="${labelClasses}" for="reg-password">Password</label>
                <div class="relative">
                  <input id="reg-password" name="password" type="password" autocomplete="new-password" class="${fieldClasses} pr-10" />
                  <button type="button" id="reg-toggle" class="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-secondary hover:text-on-surface" aria-label="Show password">${icon('visibility', 'text-[18px]')}</button>
                </div>
                <div class="mt-2 flex items-center gap-2" aria-hidden="true">
                  <div class="flex-1 h-1 rounded-full bg-surface-container-high overflow-hidden"><div id="reg-strength" class="h-full w-0 rounded-full transition-all"></div></div>
                  <span id="reg-strength-label" class="text-[11px] text-secondary w-16"></span>
                </div>
                <p class="mt-1 text-[11px] text-secondary">At least 8 characters.</p>
                <p class="mt-1 text-[11px] text-error hidden" data-error-for="password"></p>
              </div>
              <div>
                <label class="${labelClasses}" for="reg-confirm">Confirm password</label>
                <input id="reg-confirm" name="confirm" type="password" autocomplete="new-password" class="${fieldClasses}" />
                <p class="mt-1 text-[11px] text-error hidden" data-error-for="confirm"></p>
              </div>
              <button id="reg-submit" type="submit" class="${primaryButton} w-full h-10 text-sm">Create account${icon('arrow_forward', 'text-[16px]')}</button>
            </form>

            <p class="mt-6 text-xs text-on-surface-variant">Already have an account? <a href="#/login" class="font-semibold text-primary hover:underline">Sign in</a></p>
            <div class="mt-4 text-[11px] text-secondary"><span id="reg-health" class="flex items-center gap-1.5"><span class="w-1.5 h-1.5 rounded-full bg-outline"></span>Checking service…</span></div>
          </div>
        </div>
      </div>
    </div>`;

  const $ = (selector) => container.querySelector(selector);
  const form = $('#reg-form');
  const errorBox = $('#reg-error');
  const submit = $('#reg-submit');
  let countdown = null;

  const value = (name) => form.elements[name].value;
  const show = (field, message) => {
    const el = form.querySelector(`[data-error-for="${field}"]`);
    if (!el) return;
    el.innerHTML = message; // callers pass trusted markup only (see the email-taken link)
    el.classList.toggle('hidden', !message);
  };
  const clearErrors = () => {
    clearInterval(countdown);
    errorBox.classList.add('hidden');
    FIELDS.forEach((f) => show(f, ''));
  };
  const showBanner = (message) => {
    errorBox.textContent = message;
    errorBox.classList.remove('hidden');
  };

  $('#reg-toggle').addEventListener('click', () => {
    const hidden = form.elements.password.type === 'password';
    form.elements.password.type = hidden ? 'text' : 'password';
    form.elements.confirm.type = hidden ? 'text' : 'password';
  });

  form.elements.password.addEventListener('input', () => {
    const score = passwordStrength(value('password'));
    const bar = $('#reg-strength');
    bar.style.width = `${(score / 3) * 100}%`;
    bar.className = `h-full rounded-full transition-all ${['bg-error', 'bg-error', 'bg-primary', 'bg-emerald-600'][score]}`;
    $('#reg-strength-label').textContent = value('password') ? ['Too short', 'Fair', 'Good', 'Strong'][score] : '';
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors();

    const input = Object.fromEntries(FIELDS.map((f) => [f, value(f)]));
    const problems = validateRegistration(input);
    if (Object.keys(problems).length > 0) {
      for (const [field, message] of Object.entries(problems)) show(field, esc(message));
      form.elements[Object.keys(problems)[0]].focus();
      return;
    }

    submit.disabled = true;
    submit.textContent = 'Creating account…';
    try {
      const { data } = await api('POST', '/auth/register', {
        auth: false,
        body: { name: input.name.trim(), email: input.email.trim(), password: input.password },
      });
      session.set(data.token);
      await onSignedIn();
    } catch (error) {
      submit.disabled = false;
      submit.innerHTML = `Create account${icon('arrow_forward', 'text-[16px]')}`;
      handleFailure(error);
    }
  });

  function handleFailure(error) {
    if (error.code === 'EMAIL_ALREADY_EXISTS') {
      show('email', 'There is already an account with this email. <a href="#/login" class="font-semibold underline">Sign in instead</a>.');
      form.elements.email.focus();
    } else if (error.code === 'VALIDATION_ERROR' && Array.isArray(error.details)) {
      for (const d of error.details) show(d.path, esc(d.message));
      showBanner('Please check the highlighted fields.');
    } else if (error.code === 'REGISTRATION_DISABLED') {
      showBanner('Creating accounts is turned off here. Ask an administrator to create one for you.');
    } else if (error.status === 429) {
      let remaining = error.retryAfter ?? 60;
      const tick = () => {
        if (remaining <= 0) return clearErrors();
        showBanner(`Too many sign-ups from this connection. Try again in ${formatDuration(remaining)}.`);
        remaining -= 1;
      };
      tick();
      countdown = setInterval(tick, 1000);
    } else {
      showBanner(error.message);
    }
  }

  checkHealth().then((health) => {
    const el = $('#reg-health');
    if (!el) return;
    el.innerHTML = health.ok
      ? '<span class="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>Service healthy'
      : '<span class="w-1.5 h-1.5 rounded-full bg-error"></span>Service unreachable';
  });

  form.elements.name.focus();
  return () => clearInterval(countdown);
}

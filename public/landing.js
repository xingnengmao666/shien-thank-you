import { reveal, conceal } from './ui.js';

const page = document.body;
const section = document.querySelector('#write-section');
const entry = document.querySelector('#write-reveal');
const hover = matchMedia('(hover: hover) and (pointer: fine)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let frame = 0, school = 'balanced', revealed = false;

function update() {
  frame = 0;
  // Keep an open reading or writing dialog's palette stable.
  if (!document.querySelector('dialog[open]')) page.dataset.activeSchool = school;
  if (revealed) return;
  const top = section.getBoundingClientRect().top;
  const progress = Math.max(0, Math.min(1, (innerHeight - top) / Math.min(280, innerHeight * .4)));
  const amount = reducedMotion.matches && progress > 0 ? 1 : progress;
  entry.style.opacity = amount;
  entry.style.transform = `translateY(${(1 - amount) * 28}px)`;
  entry.style.visibility = amount > 0 ? 'visible' : 'hidden';
  entry.inert = amount < 1;
  // Once reached, keep the form entrance available through subsequent interactions.
  revealed = amount === 1;
}
function schedule() {
  if (!frame) frame = requestAnimationFrame(update);
}
addEventListener('pointermove', event => {
  if (!hover.matches || event.pointerType === 'touch') return;
  const next = event.clientX < innerWidth / 2 ? 'original' : 'new';
  if (school !== next) { school = next; schedule(); }
}, { passive: true });
function resetSchool() { school = 'balanced'; schedule(); }
document.addEventListener('pointerout', event => { if (!event.relatedTarget) resetSchool(); }, { passive: true });
addEventListener('blur', resetSchool);
hover.addEventListener('change', resetSchool);
reducedMotion.addEventListener('change', schedule);
addEventListener('scroll', schedule, { passive: true });
addEventListener('resize', schedule, { passive: true });
addEventListener('hashchange', schedule);
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('close', schedule));
schedule();

const themeHint = document.querySelector('#theme-hint');
const themeSelect = document.querySelector('[data-theme-select]');
const mobileScreen = matchMedia('(max-width: 700px)');
function updateThemeHint() {
  const mobile = mobileScreen.matches;
  themeHint.classList.toggle('desktop-surprise', mobile);
  themeHint.setAttribute('aria-label', mobile ? '电脑端爱心布局与主题提示' : '主题切换提示');
  themeHint.querySelector('strong').textContent = mobile ? '电脑端有爱心布局惊喜' : '换个主题，换份心情';
  themeHint.querySelector('p span').textContent = mobile ? '用电脑打开，看看祝福拼成完整爱心。手机上方也能切换主题。' : '上方“主题”可自由切换。';
  themeHint.querySelector('.theme-hint-icon').textContent = mobile ? '♡' : '✦';
}
updateThemeHint();
mobileScreen.addEventListener('change', updateThemeHint);
let hintTimer;
function dismissHint() {
  if (themeHint.contains(document.activeElement)) themeSelect.focus({ preventScroll: true });
  clearTimeout(hintTimer);
  void conceal(themeHint);
}
function scheduleHintDismiss() {
  clearTimeout(hintTimer);
  if (themeHint.hidden || themeHint.matches(':hover, :focus-within')) return;
  hintTimer = setTimeout(dismissHint, mobileScreen.matches ? 12000 : 8000);
}
hintTimer = setTimeout(() => { reveal(themeHint); scheduleHintDismiss(); }, 800);
themeHint.querySelector('.theme-hint-close').addEventListener('click', dismissHint);
themeHint.querySelector('.theme-hint-action').addEventListener('click', () => {
  dismissHint();
  themeSelect.scrollIntoView({ behavior: reducedMotion.matches ? 'instant' : 'smooth', block: 'center' });
  themeSelect.focus({ preventScroll: true });
});
themeSelect.addEventListener('change', dismissHint);
themeHint.addEventListener('pointerenter', () => clearTimeout(hintTimer));
themeHint.addEventListener('pointerleave', scheduleHintDismiss);
themeHint.addEventListener('focusin', () => clearTimeout(hintTimer));
themeHint.addEventListener('focusout', event => {
  if (!themeHint.contains(event.relatedTarget)) scheduleHintDismiss();
});

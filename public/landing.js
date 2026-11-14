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

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const fades = new WeakMap();

export function reveal(element) {
  fades.get(element)?.cancel();
  fades.delete(element);
  element.hidden = false;
  if (reducedMotion()) return;
  const animation = element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'linear' });
  fades.set(element, animation);
}

export async function conceal(element, remove = false) {
  fades.get(element)?.cancel();
  fades.delete(element);
  if (!element.hidden && !reducedMotion()) {
    const animation = element.animate([{ opacity: getComputedStyle(element).opacity }, { opacity: 0 }], { duration: 140, easing: 'linear' });
    fades.set(element, animation);
    await animation.finished.catch(() => {});
    if (fades.get(element) !== animation) return;
  }
  if (remove) element.remove();
  else element.hidden = true;
}

export function setBusy(button, busy) {
  button.disabled = busy;
  button.classList.toggle('is-busy', busy);
  if (busy) button.setAttribute('aria-busy', 'true');
  else button.removeAttribute('aria-busy');
}

let requests = 0, finishTimer;
export function startLoading() {
  clearTimeout(finishTimer);
  requests++;
  document.documentElement.classList.add('is-loading');
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    requests--;
    if (!requests) finishTimer = setTimeout(() => document.documentElement.classList.remove('is-loading'), 100);
  };
}

// Only animate a student's own saved draft inside the receipt, never onto the public wall.
export async function sendPaper(fromRect, receipt, content) {
  if (reducedMotion()) return;
  const dialog = receipt.closest('dialog'), box = dialog.getBoundingClientRect(), target = receipt.getBoundingClientRect();
  const paper = document.createElement('div');
  paper.className = 'sending-paper paper-surface';
  paper.setAttribute('aria-hidden', 'true');
  const preview = document.createElement('span');
  preview.textContent = content;
  paper.append(preview);
  paper.style.left = `${fromRect.left - box.left - dialog.clientLeft}px`;
  paper.style.top = `${fromRect.top - box.top - dialog.clientTop + dialog.scrollTop}px`;
  paper.style.width = `${fromRect.width}px`;
  paper.style.height = `${Math.min(150, fromRect.height)}px`;
  dialog.append(paper);
  const dx = target.left + target.width / 2 - fromRect.left - fromRect.width / 2;
  const dy = target.top + target.height / 2 - fromRect.top - Math.min(150, fromRect.height) / 2;
  let animation;
  const cancel = () => animation?.cancel();
  dialog.addEventListener('close', cancel, { once: true });
  try {
    animation = paper.animate([
      { transform: 'translate(0, 0) rotate(-2deg) scale(1)', opacity: 1 },
      { transform: `translate(${dx}px, ${dy}px) rotate(8deg) scale(.12)`, opacity: 0 }
    ], { duration: 440, easing: 'linear' });
    await animation.finished;
  } catch { /* Closing the dialog must not interrupt a successfully saved submission. */ }
  finally { dialog.removeEventListener('close', cancel); paper.remove(); }
}

const progress = document.createElement('div');
progress.className = 'page-progress';
progress.setAttribute('aria-hidden', 'true');
progress.append(document.createElement('span'));
document.body.prepend(progress);

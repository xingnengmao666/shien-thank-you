{
  const root = document.documentElement, key = 'shien-theme';
  function apply(value) {
    root.dataset.theme = value === 'campus' ? 'campus' : 'sakura';
    document.querySelectorAll('[data-theme-select]').forEach(select => { select.value = root.dataset.theme; });
  }
  try { apply(localStorage.getItem(key)); } catch { apply('sakura'); }
  document.addEventListener('DOMContentLoaded', () => {
    apply(root.dataset.theme);
    document.querySelectorAll('[data-theme-select]').forEach(select => select.addEventListener('change', () => {
      apply(select.value);
      try { localStorage.setItem(key, root.dataset.theme); } catch { /* Theme switching also works without browser storage. */ }
    }));
  });
  addEventListener('storage', event => { if (event.key === key) apply(event.newValue); });
}

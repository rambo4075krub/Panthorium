(function (root) {
  'use strict';
  const pinnedLast = new Set();
  const observedLists = new WeakSet();

  function normalize(value) {
    return String(value || '').normalize('NFKC').trim().toLocaleLowerCase();
  }

  function filter(query, list, emptyState) {
    if (!list) return 0;
    const needle = normalize(query);
    let visibleCount = 0;

    Array.from(list.children).forEach(function (item) {
      const accessHidden = item.hidden || item.style.display === 'none';
      const searchable = normalize(
        (item.dataset && item.dataset.searchText ? item.dataset.searchText + ' ' : '') +
        (item.textContent || '')
      );
      const matches = !accessHidden && (!needle || searchable.includes(needle));
      if (matches) {
        delete item.dataset.searchHidden;
        visibleCount++;
      } else {
        item.dataset.searchHidden = 'true';
      }
    });

    if (emptyState) emptyState.hidden = visibleCount !== 0;
    return visibleCount;
  }

  function keepPinnedLast(list) {
    if (!list) return;
    for (const id of pinnedLast) {
      const item = Array.from(list.children).find(child => child.dataset?.appId === id);
      if (item && list.lastElementChild !== item) list.appendChild(item);
    }
  }

  function pinLast(id, list) {
    const appId = String(id || '').trim();
    if (!appId) return false;
    pinnedLast.add(appId);
    const target = list || root.document?.getElementById('sm-apps');
    if (target) {
      keepPinnedLast(target);
      if (!observedLists.has(target) && root.MutationObserver) {
        observedLists.add(target);
        new root.MutationObserver(() => keepPinnedLast(target)).observe(target, { childList: true });
      }
    }
    return true;
  }

  root.PanthoriumStartMenuUI = Object.freeze({ filter: filter, pinLast: pinLast, keepPinnedLast: keepPinnedLast });
})(window);

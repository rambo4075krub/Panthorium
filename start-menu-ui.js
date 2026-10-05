(function (root) {
  'use strict';

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

  root.PanthoriumStartMenuUI = Object.freeze({ filter: filter });
})(window);

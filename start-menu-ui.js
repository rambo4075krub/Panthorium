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

    function visit(item, inheritedMatch, ancestorHidden) {
      const accessHidden = item.hidden || item.style.display === 'none';
      if (item.dataset && item.dataset.startGroup) {
        const groupMatch = !!needle && normalize(item.dataset.searchText || '').includes(needle);
        let count = 0;
        Array.from(item.querySelectorAll('.sm-app')).forEach(child => {
          count += visit(child, inheritedMatch || groupMatch, ancestorHidden || accessHidden);
        });
        if (count) delete item.dataset.searchHidden;
        else item.dataset.searchHidden = 'true';
        return count;
      }
      const searchable = normalize(
        (item.dataset && item.dataset.searchText ? item.dataset.searchText + ' ' : '') +
        (item.textContent || '')
      );
      const matches = !ancestorHidden && !accessHidden && (!needle || inheritedMatch || searchable.includes(needle));
      if (matches) {
        delete item.dataset.searchHidden;
      } else {
        item.dataset.searchHidden = 'true';
      }
      return matches ? 1 : 0;
    }
    Array.from(list.children).forEach(item => { visibleCount += visit(item, false, false); });

    if (emptyState) emptyState.hidden = visibleCount !== 0;
    return visibleCount;
  }

  // A group is a Start Menu container, never a desktop launcher. Its stable
  // app id lets the existing account shell preserve it for registered users.
  function group(id, label, list) {
    const target = list || root.document?.getElementById('sm-apps');
    if (!target || !/^[a-z][a-z0-9-]*$/.test(String(id || ''))) return null;
    let section = Array.from(target.children).find(item => item.dataset?.startGroup === id);
    if (section) return section;
    const doc = target.ownerDocument;
    section = doc.createElement('section');
    section.dataset.startGroup = id;
    section.dataset.appId = 'cloud-group-' + id;
    section.dataset.searchText = label;
    section.setAttribute('role', 'group');
    section.setAttribute('aria-label', label);
    const heading = doc.createElement('div');
    heading.textContent = label;
    heading.style.cssText = 'padding:12px 10px 5px;color:var(--text-dim);font-size:11px;letter-spacing:.04em';
    section.appendChild(heading);
    section.addEventListener('click', event => {
      // The shell's Enter shortcut activates its first visible direct child.
      if (event.target === section) Array.from(section.querySelectorAll('.sm-app')).find(item => !item.hidden && item.style.display !== 'none' && item.dataset.searchHidden !== 'true')?.click();
    });
    target.appendChild(section);
    keepPinnedLast(target);
    return section;
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

  root.PanthoriumStartMenuUI = Object.freeze({ filter: filter, pinLast: pinLast, keepPinnedLast: keepPinnedLast, group: group });
})(window);

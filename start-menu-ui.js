(function (root) {
  'use strict';
  const pinnedLast = new Set();
  const lists = new WeakMap();
  const groupState = new WeakMap();
  let sequence = 0;
  const paths = {
    social:'M16 21v-3c0-3-2-5-5-5s-5 2-5 5v3M11 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM17 5c4 0 4 6 0 6M19 14c2 1 3 3 3 6',
    life: 'M12 21s-8-5-8-11a4 4 0 0 1 8-2 4 4 0 0 1 8 2c0 6-8 11-8 11Z',
    study: 'm3 8 9-5 9 5-9 5-9-5Zm3 2v7c3 3 9 3 12 0v-7M21 8v8',
    work: 'M8 6V4h8v2M3 7h18v13H3V7Zm0 5c6 4 12 4 18 0M10 13h4v3h-4v-3Z',
    specialist: 'm12 3 3 6 6 3-6 3-3 6-3-6-6-3 6-3 3-6Z',
    organizations: 'M9 3h6v6H9V3ZM3 15h6v6H3v-6Zm12 0h6v6h-6v-6ZM12 9v3M6 15v-3h12v3',
    people: 'M16 21v-3c0-3-2-5-5-5s-5 2-5 5v3M11 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM17 5c4 0 4 6 0 6M19 14c2 1 3 3 3 6',
    document: 'M6 3h9l4 4v14H6V3Zm9 0v5h4M9 12h7M9 16h7',
    chart: 'M4 3v18h17M8 17v-5M13 17V8M18 17V5',
    code: 'm8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18',
    tool: 'M14 4a6 6 0 0 0-7 8l-5 5 5 5 5-5a6 6 0 0 0 8-7l-4 4-5-5 3-5Z',
    health: 'M9 3h6v6h6v6h-6v6H9v-6H3V9h6V3Z',
    balance: 'M12 3v18M7 21h10M4 7h16M6 7l-4 8h8L6 7Zm12 0-4 8h8l-4-8Z',
    leaf: 'M20 3C9 3 3 7 3 13c0 5 4 8 8 7 7-1 9-9 9-17ZM4 20 16 8',
    transport: 'M3 5h12v13H3V5Zm12 5h4l3 4v4h-7M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm12 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
    food: 'M4 3v6c0 4 6 4 6 0V3M7 3v18M18 3c-4 4-4 10 0 10h2M20 3v18',
    home: 'm3 11 9-8 9 8M5 10v11h14V10M9 21v-7h6v7',
    pen: 'm4 16 12-12 4 4L8 20H4v-4Zm9-9 4 4M3 22h18',
    creative: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3ZM20 3v4M18 5h4',
    image: 'M3 4h18v16H3V4Zm0 12 5-5 4 4 3-3 6 6M16 7h.01',
    video: 'M3 5h13v14H3V5Zm13 5 5-3v10l-5-3M7 9l5 3-5 3V9Z',
    presentation: 'M3 4h18v13H3V4ZM12 17v4M7 21l5-4 5 4M7 12V9M12 12V7M17 12v-2',
    chevron: 'm8 5 7 7-7 7'
  };
  function normalize(value) { return String(value || '').normalize('NFKC').trim().toLocaleLowerCase(); }
  function icon(name, doc) {
    doc = doc || root.document;
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(key, value);
    const path = doc.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', paths[name] || paths.document); svg.appendChild(path); return svg;
  }
  function styles(doc) {
    if (doc.getElementById('start-menu-groups-style')) return;
    const style = doc.createElement('style'); style.id = 'start-menu-groups-style';
    style.textContent = `
      #sm-apps [data-start-group]{flex:none;border:1px solid rgba(120,170,195,.13);border-radius:13px;overflow:hidden}
      #sm-apps [data-start-group][hidden],#sm-apps [data-search-hidden="true"],#sm-apps [data-start-group-items][hidden]{display:none!important}
      .sm-group-toggle{width:100%;display:flex;align-items:center;gap:11px;min-height:54px;padding:10px 12px;border:0;background:rgba(90,140,170,.065);color:var(--text,#e8eef8);font:inherit;text-align:left;cursor:pointer}
      .sm-group-toggle:hover{background:rgba(90,140,170,.15)}
      .sm-group-toggle:focus-visible{outline:2px solid var(--accent,#66d0ff);outline-offset:-3px;border-radius:12px}
      .sm-group-icon,.sm-pack-icon{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex:0 0 28px;color:var(--text-dim,#9bb1c9)}
      .sm-group-icon svg,.sm-pack-icon svg{width:22px;height:22px}.sm-group-label{flex:1;min-width:0;font-size:13px;font-weight:600}
      .sm-group-count{font-size:11px;color:var(--text-dim,#9bb1c9);font-variant-numeric:tabular-nums}
      .sm-group-chevron{width:15px;height:15px;flex:none;transition:transform .16s ease}.sm-group-toggle[aria-expanded="true"] .sm-group-chevron{transform:rotate(90deg)}
      #sm-apps [data-start-group-items]{padding:4px 4px 5px 11px;margin:0 6px 5px 15px;border-left:1px solid rgba(120,170,195,.18)}
      #sm-apps [data-start-group-items] .sm-app{width:100%;text-align:left;min-height:44px;padding:8px;gap:9px}
      #sm-apps .sm-app .sm-pack-icon{flex:0 0 25px;width:25px;color:var(--text-dim,#9bb1c9)}
      #sm-apps [data-start-group-items] .sm-app small{flex:none;font-size:10px;color:var(--text-dim,#9bb1c9)}
      @media(prefers-reduced-motion:reduce){.sm-group-chevron{transition:none}}
    `;
    doc.head.appendChild(style);
  }
  function setExpanded(section, expanded) {
    const state = groupState.get(section); if (!state) return;
    const value = String(!!expanded);
    if (state.toggle.getAttribute('aria-expanded') !== value) state.toggle.setAttribute('aria-expanded', value);
    if (state.body.hidden === !!expanded) state.body.hidden = !expanded;
  }
  function listState(list) {
    let state = lists.get(list); if (state) return state;
    state = { query: '', emptyState: null, preferences: new Map() }; lists.set(list, state);
    if (root.MutationObserver) {
      state.observer = new root.MutationObserver(records => {
        if (!records.some(record => record.type === 'childList' || !record.target.hasAttribute('data-start-group-items'))) return;
        for (const section of Array.from(list.children)) {
          const group = groupState.get(section); if (!group) continue;
          for (const child of Array.from(section.children)) if (child.classList.contains('sm-app')) group.body.appendChild(child);
        }
        keepPinnedLast(list);
        filter(state.query, list, state.emptyState);
      });
      state.observer.observe(list, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'style', 'data-search-text'] });
    }
    return state;
  }
  function filter(query, list, emptyState) {
    if (!list) return 0;
    const state = listState(list), needle = normalize(query); state.query = needle; state.emptyState = emptyState || null;
    function visit(item, inheritedMatch, ancestorHidden) {
      const accessHidden = hiddenByAccess(item, list);
      if (item.dataset?.startGroup) {
        const groupMatch = !!needle && normalize(item.dataset.searchText || '').includes(needle);
        let count = 0;
        for (const child of item.querySelectorAll('.sm-app')) count += visit(child, inheritedMatch || groupMatch, ancestorHidden || accessHidden);
        if (count) delete item.dataset.searchHidden; else item.dataset.searchHidden = 'true';
        const group = groupState.get(item);
        if (group) {
          if (group.count.textContent !== String(count)) group.count.textContent = String(count);
          group.count.setAttribute('aria-label', count + ' รายการ');
          setExpanded(item, needle ? count > 0 : state.preferences.get(item.dataset.startGroup) === true);
        }
        return count;
      }
      const searchable = normalize((item.dataset?.searchText || '') + ' ' + (item.textContent || ''));
      const matches = !ancestorHidden && !accessHidden && (!needle || inheritedMatch || searchable.includes(needle));
      if (matches) delete item.dataset.searchHidden; else item.dataset.searchHidden = 'true';
      return matches ? 1 : 0;
    }
    let count = 0;
    for (const item of Array.from(list.children)) count += visit(item, false, false);
    if (emptyState) emptyState.hidden = count !== 0;
    return count;
  }
  // Keep returning the section for existing producers. Legacy appendChild calls
  // are adopted into the body without cloning the launcher or its listeners.
  function group(id, label, list) {
    const target = list || root.document?.getElementById('sm-apps');
    if (!target || !/^[a-z][a-z0-9-]*$/.test(String(id || ''))) return null;
    let section = Array.from(target.children).find(item => item.dataset?.startGroup === id);
    if (section) return section;
    const doc = target.ownerDocument, state = listState(target); styles(doc);
    section = doc.createElement('section'); section.dataset.startGroup = id; section.dataset.appId = 'cloud-group-' + id; section.dataset.searchText = label;
    const toggle = doc.createElement('button'); toggle.type = 'button'; toggle.className = 'sm-group-toggle'; toggle.dataset.startGroupToggle = id;
    const body = doc.createElement('div'); body.dataset.startGroupItems = id; body.id = 'sm-group-items-' + (++sequence); body.hidden = true;
    const headingId = 'sm-group-heading-' + sequence; toggle.id = headingId; toggle.setAttribute('aria-controls', body.id); toggle.setAttribute('aria-expanded', 'false');
    section.setAttribute('role', 'group'); section.setAttribute('aria-labelledby', headingId);
    const graphic = doc.createElement('span'); graphic.className = 'sm-group-icon'; graphic.appendChild(icon(id, doc));
    const title = doc.createElement('span'); title.className = 'sm-group-label'; title.textContent = label;
    const count = doc.createElement('span'); count.className = 'sm-group-count'; count.textContent = '0';
    const chevron = icon('chevron', doc); chevron.classList.add('sm-group-chevron'); toggle.append(graphic, title, count, chevron);
    section.append(toggle, body); groupState.set(section, { toggle, body, count });
    const change = expanded => { if (!state.query) state.preferences.set(id, expanded); setExpanded(section, expanded); };
    toggle.addEventListener('click', () => change(toggle.getAttribute('aria-expanded') !== 'true'));
    toggle.addEventListener('keydown', event => {
      if (['Enter', ' ', 'Spacebar'].includes(event.key)) { event.preventDefault(); if (!event.repeat) toggle.click(); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); change(true); }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); change(false); }
      else if (event.key === 'ArrowDown') { event.preventDefault(); change(true); firstLeaf(section)?.focus(); }
    });
    body.addEventListener('keydown', event => { if (event.key === 'ArrowLeft') { event.preventDefault(); change(false); toggle.focus(); } });
    section.addEventListener('click', event => { if (event.target === section && !section.hidden && section.style.display !== 'none') firstLeaf(section)?.click(); });
    target.appendChild(section); setExpanded(section, state.preferences.get(id) === true); keepPinnedLast(target); return section;
  }
  function hiddenByAccess(item, boundary) {
    for (let node = item; node && node !== boundary; node = node.parentElement) {
      if (node.hasAttribute('data-start-group-items')) continue;
      if (node.hidden || node.style.display === 'none') return true;
    }
    return false;
  }
  function firstLeaf(section) { return Array.from(section.querySelectorAll('.sm-app')).find(item => !item.disabled && !hiddenByAccess(item, section.parentElement) && item.dataset.searchHidden !== 'true'); }
  function groupItems(section) { return groupState.get(section)?.body || section; }
  function keepPinnedLast(list) {
    if (!list) return;
    const children = Array.from(list.children), pinned = [...pinnedLast].map(id => children.find(child => child.dataset?.appId === id)).filter(Boolean);
    // Keep the public contact entry immediately beside Privacy/Policy, even after extensions append apps.
    const contact = children.find(child => child.dataset?.appId === "contact");
    const policyIndex = pinned.findIndex(child => child.dataset?.appId === "privacy-policy");
    if (contact && policyIndex >= 0) pinned.splice(policyIndex, 0, contact);
    const tail = children.slice(children.length - pinned.length);
    if (pinned.some((item, index) => tail[index] !== item)) for (const item of pinned) list.appendChild(item);
  }
  function pinLast(id, list) {
    const appId = String(id || '').trim(); if (!appId) return false; pinnedLast.add(appId);
    const target = list || root.document?.getElementById('sm-apps');
    if (target) { listState(target); keepPinnedLast(target); }
    return true;
  }
  root.PanthoriumStartMenuUI = Object.freeze({ filter, pinLast, keepPinnedLast, group, groupItems, icon });
})(window);

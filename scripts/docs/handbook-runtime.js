    const tabs = [...document.querySelectorAll('[data-mode-button]')];
    const panels = [...document.querySelectorAll('[data-tab-panel]')];
    const articles = [...document.querySelectorAll('[data-document]')];
    const guides = [...document.querySelectorAll('[data-guide]')];
    const articleLinks = [...document.querySelectorAll('[data-article-link]')];
    const search = document.querySelector('#search');
    const searchResults = document.querySelector('#search-results');
    const searchScopeButtons = [...document.querySelectorAll('[data-search-scope]')];
    const empty = document.querySelector('#empty');
    const noResultSystemLink = document.querySelector('[data-no-result-system]');
    const count = document.querySelector('#result-count');
    const hero = document.querySelector('.hero');
    const readingCanvas = document.querySelector('.reading-canvas');
    const pageToc = document.querySelector('[data-page-toc]');
    const routeNotice = document.querySelector('#route-notice');
    const topbar = document.querySelector('.topbar');
    const drawerTriggers = [...document.querySelectorAll('[data-open-drawer]')];
    const drawers = { contents: document.querySelector('#contents-rail'), toc: document.querySelector('#page-toc') };
    const printTrigger = document.querySelector('[data-print-trigger]');
    const printMenu = document.querySelector('#print-menu');
    const screenshotViewer = document.querySelector('[data-screenshot-surface]');
    const screenshotViewerImage = screenshotViewer?.querySelector('[data-screenshot-viewer-image]');
    const screenshotViewerCaption = screenshotViewer?.querySelector('[data-screenshot-viewer-caption]');
    const modeIds = new Set(tabs.map((tab) => tab.dataset.mode));
    const handbookIndex = Array.isArray(window.__HANDBOOK_INDEX__) ? window.__HANDBOOK_INDEX__ : [];
    const systemSearchIntentTerms = Array.isArray(window.__HANDBOOK_SYSTEM_INTENTS__) ? window.__HANDBOOK_SYSTEM_INTENTS__.map(normalizeSearchText).filter(Boolean) : [];
    const legacyRoutes = Array.isArray(window.__HANDBOOK_LEGACY_ROUTES__) ? window.__HANDBOOK_LEGACY_ROUTES__ : [];
    const storageKey = 'mwell-intra-handbook:v3';
    const legacyStorageKey = 'mwell-intra-handbook:v2';
    const storedState = readStoredState();
    const restoredState = normalizeStoredState(storedState);
    let activeRoute = { modeId: 'home', guideId: 'home', headingId: null, query: '', scope: 'all' };
    let disclosures = Object.fromEntries(Object.entries(restoredState.disclosures).map(([guideId, ids]) => [guideId, new Set(ids)]));
    let disclosureStateBeforeSearch = null;
    let diagramViews = { ...restoredState.diagramViews };
    let diagramZoom = { ...restoredState.diagramZoom };
    let diagramModes = { ...restoredState.diagramModes };
    let guideScroll = { ...restoredState.guideScroll };
    let recentGuides = [...restoredState.recentGuides];
    let persistenceTimer = null;
    let diagramsReady = false;
    let activeDrawer = null;
    let activeCompactSurface = null;
    let compactSurfaceReturnFocus = null;
    let compactSurfaceParent = null;
    let compactSurfaceParentReturnFocus = null;
    let compactModalInertState = new Map();
    let printScope = 'guide';

    function normalizeStoredState(value) {
      const stored = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
      const route = stored.activeRoute && typeof stored.activeRoute === 'object' ? stored.activeRoute : {};
      const modeId = typeof route.modeId === 'string' && route.modeId ? route.modeId : 'home';
      const guideId = typeof route.guideId === 'string' && route.guideId ? route.guideId : (modeId === 'home' ? 'home' : null);
      const headingId = typeof route.headingId === 'string' && route.headingId ? route.headingId : null;
      const query = typeof route.query === 'string' ? route.query.trim() : '';
      const scope = route.scope === 'mode' || route.scope === 'tab' ? 'mode' : 'all';
      const guideScroll = Object.fromEntries(Object.entries(stored.guideScroll && typeof stored.guideScroll === 'object' ? stored.guideScroll : {})
        .filter(([id, position]) => id && Number.isFinite(position) && position >= 0));
      const recentGuides = [...new Set(Array.isArray(stored.recentGuides) ? stored.recentGuides.filter((id) => typeof id === 'string' && id) : [])].slice(0, 10);
      const disclosures = Object.fromEntries(Object.entries(stored.disclosures && typeof stored.disclosures === 'object' ? stored.disclosures : {})
        .filter(([guideId, ids]) => guideId && Array.isArray(ids))
        .map(([guideId, ids]) => [guideId, [...new Set(ids.filter((id) => typeof id === 'string' && id))]]));
      const diagramViews = {};
      Object.entries(stored.diagramViews && typeof stored.diagramViews === 'object' ? stored.diagramViews : {}).forEach(([id, view]) => {
        if (!view || typeof view !== 'object' || !Number.isFinite(view.left) || !Number.isFinite(view.top)) return;
        diagramViews[id] = { left: Math.max(0, view.left), top: Math.max(0, view.top) };
      });
      const diagramZoom = Object.fromEntries(Object.entries(stored.diagramZoom && typeof stored.diagramZoom === 'object' ? stored.diagramZoom : {})
        .filter(([, zoom]) => zoom === 'fit' || Number.isFinite(zoom))
        .map(([id, zoom]) => [id, zoom === 'fit' ? zoom : Math.min(1.8, Math.max(.6, zoom))]));
      const diagramModes = Object.fromEntries(Object.entries(stored.diagramModes && typeof stored.diagramModes === 'object' ? stored.diagramModes : {})
        .filter(([, mode]) => ['overview', 'role', 'decision'].includes(mode)));
      return {
        activeRoute: { modeId, guideId, headingId, query, scope },
        guideScroll,
        recentGuides,
        disclosures,
        diagramViews,
        diagramZoom,
        diagramModes,
        theme: stored.theme === 'dark' ? 'dark' : 'light',
      };
    }

    function migrateV2State(value, routes) {
      const stored = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
      const legacyRoute = routes.find((route) => route.legacyTabId === stored.activeTab && route.legacyArticleId === stored.activeArticle && !route.legacyHeadingId);
      const query = typeof stored.query === 'string' ? stored.query.trim() : '';
      const scope = stored.scope === 'tab' || stored.scope === 'mode' ? 'mode' : 'all';
      const activeRoute = legacyRoute
        ? { modeId: legacyRoute.modeId, guideId: legacyRoute.guideId, headingId: legacyRoute.headingId || null, query, scope }
        : { modeId: 'home', guideId: 'home', headingId: null, query, scope };
      const disclosures = {};
      (Array.isArray(stored.expandedIds) ? stored.expandedIds : []).filter((id) => typeof id === 'string' && id.includes(':')).forEach((id) => {
        const guideId = id.slice(0, id.indexOf(':'));
        disclosures[guideId] = [...new Set([...(disclosures[guideId] || []), id])];
      });
      const savedPosition = stored.tabScroll && typeof stored.tabScroll === 'object' ? stored.tabScroll[stored.activeTab] : null;
      const guideScroll = legacyRoute && activeRoute.guideId && Number.isFinite(savedPosition) && savedPosition >= 0 ? { [activeRoute.guideId]: savedPosition } : {};
      return {
        activeRoute,
        guideScroll,
        recentGuides: legacyRoute && activeRoute.guideId && activeRoute.guideId !== 'home' ? [activeRoute.guideId] : [],
        disclosures,
        diagramViews: stored.diagramViews && typeof stored.diagramViews === 'object' ? stored.diagramViews : {},
        diagramZoom: stored.diagramZoom && typeof stored.diagramZoom === 'object' ? stored.diagramZoom : {},
        diagramModes: stored.diagramModes && typeof stored.diagramModes === 'object' ? stored.diagramModes : {},
        theme: stored.theme === 'dark' ? 'dark' : 'light',
      };
    }

    function readStoredState() {
      try {
        const stored = localStorage.getItem(storageKey);
        if (stored) return JSON.parse(stored);
        const legacy = localStorage.getItem(legacyStorageKey);
        if (!legacy) return null;
        const migrated = migrateV2State(JSON.parse(legacy), legacyRoutes);
        localStorage.setItem(storageKey, JSON.stringify(migrated));
        localStorage.removeItem(legacyStorageKey);
        return migrated;
      } catch (_) {
        return null;
      }
    }

    function normalizeSearchText(value) {
      return String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('en-PH');
    }

    function parseRoute(hash = location.hash) {
      const params = new URLSearchParams(hash.replace(/^#/, ''));
      const query = params.get('q') || '';
      const scope = params.get('scope') === 'mode' || params.get('scope') === 'tab' ? 'mode' : 'all';
      if (params.has('mode') || params.has('guide')) {
        const modeId = params.get('mode') || '';
        return { modeId, guideId: params.get('guide') || (modeId === 'home' ? 'home' : null), headingId: params.get('heading'), query, scope };
      }
      if (params.has('tab') || params.has('article')) {
        const tabId = params.get('tab');
        const articleId = params.get('article');
        const headingId = params.get('heading');
        const translated = legacyRoutes.find((route) => route.legacyTabId === tabId && route.legacyArticleId === articleId && (route.legacyHeadingId || null) === (headingId || null));
        if (translated) return { modeId: translated.modeId, guideId: translated.guideId, headingId: translated.headingId || null, query, scope };
        return { modeId: '', guideId: '', headingId: null, query, scope };
      }
      if (!hash.replace(/^#/, '').trim()) return { modeId: 'home', guideId: 'home', headingId: null, query, scope };
      return { modeId: '', guideId: '', headingId: null, query, scope };
    }

    function routeHash({ modeId, guideId, headingId, query, scope }) {
      const params = new URLSearchParams({ mode: modeId });
      if (guideId) params.set('guide', guideId);
      if (headingId) params.set('heading', headingId);
      if (query) params.set("q", query);
      if (query || scope === 'mode') params.set("scope", scope);
      return `#${params}`;
    }

    function isDrawerViewport() { return window.matchMedia('(max-width: 1180px)').matches; }
    function setHeaderOffset() { document.documentElement.style.setProperty('--handbook-header-height', `${topbar.offsetHeight}px`); }

    function compactSurfaceElement(name) {
      if (name === 'search' || name === 'contents') return drawers.contents;
      if (name === 'toc') return drawers.toc;
      if (name === 'print') return printMenu;
      if (String(name || '').startsWith('screenshot:')) return screenshotViewer;
      return null;
    }

    function compactSurfaceTrigger(name) {
      if (name === 'search') return search;
      if (name === 'print') return printTrigger;
      if (name === 'contents' || name === 'toc') return drawerTriggers.find((button) => button.dataset.openDrawer === name) || null;
      return document.querySelector(`[data-open-screenshot-surface="${CSS.escape(String(name || '').replace(/^screenshot:/, ''))}"]`);
    }

    function setCompactSurfaceExpanded(name, expanded) {
      if (name === 'toc') drawerTriggers.filter((button) => button.dataset.openDrawer === 'toc').forEach((button) => button.setAttribute('aria-expanded', String(expanded)));
      const trigger = compactSurfaceTrigger(name);
      if (trigger && name !== 'search' && name !== 'toc') trigger.setAttribute('aria-expanded', String(expanded));
      if (name === 'search') drawerTriggers.filter((button) => button.dataset.openDrawer === 'contents').forEach((button) => button.setAttribute('aria-expanded', String(expanded)));
    }

    function prepareScreenshotViewer(name) {
      const id = String(name || '').replace(/^screenshot:/, '');
      const trigger = document.querySelector(`[data-open-screenshot-surface="${CSS.escape(id)}"]`);
      const sourceImage = trigger?.querySelector('img');
      const caption = trigger?.closest('figure')?.querySelector('figcaption');
      if (!trigger || !sourceImage || !screenshotViewerImage || !screenshotViewerCaption) return false;
      screenshotViewerImage.src = sourceImage.currentSrc || sourceImage.src;
      screenshotViewerImage.alt = sourceImage.alt;
      screenshotViewerCaption.textContent = caption?.textContent?.trim() || sourceImage.alt;
      return true;
    }

    function clearCompactModalIsolation() {
      compactModalInertState.forEach((wasInert, element) => { element.inert = wasInert; });
      compactModalInertState = new Map();
    }

    function isolateCompactModal(surface) {
      clearCompactModalIsolation();
      for (let branch = surface; branch && branch !== document.body; branch = branch.parentElement) {
        const parent = branch.parentElement;
        if (!parent) break;
        [...parent.children].filter((sibling) => sibling !== branch).forEach((sibling) => {
          if (!compactModalInertState.has(sibling)) compactModalInertState.set(sibling, sibling.inert);
          sibling.inert = true;
        });
      }
    }

    function closeCompactSurface({ restoreFocus = true } = {}) {
      if (!activeCompactSurface) return;
      const name = activeCompactSurface;
      const surface = compactSurfaceElement(name);
      const returnFocus = compactSurfaceReturnFocus;
      const parentSurface = compactSurfaceParent;
      const parentReturnFocus = compactSurfaceParentReturnFocus;
      activeCompactSurface = null;
      compactSurfaceReturnFocus = null;
      compactSurfaceParent = null;
      compactSurfaceParentReturnFocus = null;
      clearCompactModalIsolation();
      document.body.classList.remove('drawer-open');
      if (surface) {
        surface.hidden = true;
        surface.removeAttribute('data-search-surface');
        surface.removeAttribute('aria-modal');
        if (name === 'contents' || name === 'toc') surface.removeAttribute('role');
      }
      setCompactSurfaceExpanded(name, false);
      if (name === 'contents' || name === 'toc') activeDrawer = null;
      if (restoreFocus && parentSurface && isDrawerViewport()) {
        openCompactSurface(parentSurface, { focusSurface: false });
        compactSurfaceReturnFocus = parentReturnFocus;
        if (returnFocus?.isConnected) returnFocus.focus();
        return;
      }
      if (restoreFocus && returnFocus?.isConnected) returnFocus.focus();
    }

    function openCompactSurface(name, { focusSurface = true } = {}) {
      const surface = compactSurfaceElement(name);
      const globallyModal = name === 'toc' || String(name || '').startsWith('screenshot:');
      if (!surface || (!isDrawerViewport() && !globallyModal)) return false;
      if (String(name || '').startsWith('screenshot:') && !prepareScreenshotViewer(name)) return false;
      const previousSurface = activeCompactSurface;
      if (previousSurface === name) return true;
      const parentSurface = name === 'print' && ['contents', 'search'].includes(previousSurface) ? previousSurface : null;
      const parentReturnFocus = parentSurface ? compactSurfaceReturnFocus : null;
      closeCompactSurface({ restoreFocus: false });
      activeCompactSurface = name;
      compactSurfaceReturnFocus = name === 'search' ? search : (document.activeElement instanceof HTMLElement ? document.activeElement : compactSurfaceTrigger(name));
      compactSurfaceParent = parentSurface;
      compactSurfaceParentReturnFocus = parentReturnFocus;
      surface.hidden = false;
      setCompactSurfaceExpanded(name, true);
      if (name === 'search') {
        activeDrawer = null;
        surface.setAttribute('data-search-surface', '');
        surface.removeAttribute('role');
        surface.removeAttribute('aria-modal');
        if (previousSurface && previousSurface !== 'search') search.focus();
        return true;
      }
      surface.removeAttribute('data-search-surface');
      surface.setAttribute('role', 'dialog');
      surface.setAttribute('aria-modal', 'true');
      activeDrawer = name === 'contents' || name === 'toc' ? name : null;
      document.body.classList.add('drawer-open');
      isolateCompactModal(surface);
      if (focusSurface) focusableIn(surface)[0]?.focus();
      return true;
    }

    function setSearchSurfaceVisible(visible, { restoreFocus = true } = {}) {
      const drawer = drawers.contents;
      if (!drawer || !isDrawerViewport()) return;
      if (!visible) {
        if (activeCompactSurface !== 'search' && !drawer.hasAttribute('data-search-surface')) return;
        closeCompactSurface({ restoreFocus });
        return;
      }
      openCompactSurface('search', { focusSurface: false });
    }

    function setDrawerVisible(name, visible, { restoreFocus = true } = {}) {
      const drawer = drawers[name];
      if (!drawer || (name === 'contents' && !isDrawerViewport())) return;
      if (!visible) {
        if (activeCompactSurface === name || (name === 'contents' && activeCompactSurface === 'search')) closeCompactSurface({ restoreFocus });
        return;
      }
      openCompactSurface(name);
    }
    function resetDrawers() {
      closeCompactSurface({ restoreFocus: false });
      Object.entries(drawers).forEach(([name, drawer]) => {
        if (!drawer) return;
        drawer.removeAttribute('data-search-surface');
        drawer.hidden = name === 'toc' || isDrawerViewport();
        if (!drawer.hidden) { drawer.removeAttribute('role'); drawer.removeAttribute('aria-modal'); }
      });
      activeDrawer = null; document.body.classList.remove('drawer-open');
      drawerTriggers.forEach((button) => button.setAttribute('aria-expanded', 'false'));
      if (printMenu) { printMenu.hidden = true; printMenu.removeAttribute('aria-modal'); }
      printTrigger?.setAttribute('aria-expanded', 'false');
      setHeaderOffset();
    }
    function focusableIn(element) { return [...element.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((candidate) => !candidate.hidden && candidate.getClientRects().length > 0); }
    function applyPrintScope(scope) {
      printScope = ['guide', 'mode', 'all'].includes(scope) ? scope : 'guide';
      document.documentElement.dataset.printScope = printScope;
      articles.forEach((article) => {
        const include = printScope === 'all' || (printScope === 'mode' && article.dataset.mode === activeRoute.modeId) || (printScope === 'guide' && article.dataset.guideId === activeRoute.guideId);
        article.dataset.printInScope = String(include);
      });
    }

    function captureDisclosureState() {
      disclosureStateBeforeSearch = new Set([...document.querySelectorAll('details[data-section-id]')].filter((details) => details.open).map((details) => details.dataset.sectionId));
    }

    function restoreDisclosureState() {
      if (!disclosureStateBeforeSearch) return;
      document.querySelectorAll('details[data-section-id]').forEach((details) => { details.open = disclosureStateBeforeSearch.has(details.dataset.sectionId); });
      disclosureStateBeforeSearch = null;
    }

    function openContainingDisclosure(target) {
      for (let ancestor = target?.parentElement; ancestor; ancestor = ancestor.parentElement) {
        if (ancestor.matches('details[data-section-id]')) ancestor.open = true;
      }
    }

    function syncDisclosureState() {
      if (activeRoute.query || !activeRoute.guideId) return;
      const guide = guides.find((candidate) => candidate.dataset.guideId === activeRoute.guideId);
      if (!guide) return;
      disclosures[activeRoute.guideId] = new Set([...guide.querySelectorAll('details[data-section-id]')].filter((details) => details.open).map((details) => details.dataset.sectionId));
      schedulePersistence();
    }

    function applyStoredDisclosures() {
      if (!storedState) return;
      document.querySelectorAll('details[data-section-id]').forEach((details) => {
        const guide = details.closest('[data-guide]');
        details.open = Boolean(guide && disclosures[guide.dataset.guideId]?.has(details.dataset.sectionId));
      });
    }

    function currentStoredState() {
      return {
        activeRoute,
        guideScroll,
        recentGuides,
        disclosures: Object.fromEntries(Object.entries(disclosures).map(([guideId, ids]) => [guideId, [...ids].sort()])),
        diagramViews,
        diagramZoom,
        diagramModes,
        theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
      };
    }

    function schedulePersistence() {
      window.clearTimeout(persistenceTimer);
      persistenceTimer = window.setTimeout(() => {
        try { localStorage.setItem(storageKey, JSON.stringify(currentStoredState())); } catch (_) { /* Local storage can be unavailable for offline files. */ }
      }, 100);
    }

    function describeMatch(record, query) {
      const fields = { title: normalizeSearchText(record.title), heading: normalizeSearchText(record.heading), keywords: normalizeSearchText((record.keywords || []).join(' ')), summary: normalizeSearchText(record.summary), audience: normalizeSearchText((record.audience || []).join(' ')), source: normalizeSearchText(record.source), text: normalizeSearchText(record.searchText || record.text) };
      const typePriority = { Task: 0, Step: 1, Decision: 2, Role: 3, Troubleshooting: 4, 'System reference': 50 }[record.type] ?? 25;
      const combined = Object.values(fields).join(' ');
      const queryWords = query.split(' ').filter(Boolean);
      if (fields.title === query) return { rank: typePriority, reason: `Exact ${record.type.toLowerCase()} title` };
      if (fields.heading === query) return { rank: 1 + typePriority, reason: `Exact ${record.type.toLowerCase()} destination` };
      if (fields.keywords.includes(query)) return { rank: 2 + typePriority, reason: record.whyMatched || 'Controlled handbook term' };
      if (fields.title.includes(query)) return { rank: 4 + typePriority, reason: `${record.type} title` };
      if (fields.heading.includes(query)) return { rank: 5 + typePriority, reason: `${record.type} destination heading` };
      if (fields.summary.includes(query)) return { rank: 7 + typePriority, reason: `${record.type} action excerpt` };
      if (fields.audience.includes(query)) return { rank: 8 + typePriority, reason: 'Applicable role' };
      if (fields.text.includes(query)) return { rank: 9 + typePriority, reason: record.whyMatched || `${record.type} guidance` };
      if (queryWords.length > 1 && queryWords.every((word) => combined.includes(word))) return { rank: 14 + typePriority, reason: `Related ${record.type.toLowerCase()} terms` };
      if (fields.source.includes(query)) return { rank: 30 + typePriority, reason: 'Governed source path' };
      return null;
    }

    function hasSystemSearchIntent(query) {
      const words = new Set(query.split(' ').filter(Boolean));
      return systemSearchIntentTerms.some((term) => term.includes(' ') ? query.includes(term) : words.has(term));
    }

    function searchExcerptForQuery(value, query, limit = 240) {
      const text = String(value || '').replace(/\s+/g, ' ').trim();
      const needle = normalizeSearchText(query);
      const index = normalizeSearchText(text).indexOf(needle);
      if (index < 0 || text.length <= limit) return text.slice(0, limit).trimEnd();
      const start = Math.max(0, index - Math.floor((limit - needle.length) / 2));
      const end = Math.min(text.length, start + limit);
      return `${start > 0 ? '...' : ''}${text.slice(start, end).trim()}${end < text.length ? '...' : ''}`;
    }

    function rankSearchResults() {
      const query = normalizeSearchText(activeRoute.query);
      if (!query) return [];
      const systemIntent = activeRoute.modeId === 'system' || hasSystemSearchIntent(query);
      const ranked = handbookIndex
        .filter((record) => (activeRoute.scope === 'all' || record.modeId === activeRoute.modeId) && (record.modeId !== 'system' || systemIntent))
        .map((record, index) => ({ record, index, match: describeMatch(record, query) }))
        .filter(({ match }) => match)
        .sort((left, right) => left.match.rank - right.match.rank || left.index - right.index);
      const seen = new Set();
      const perGuide = new Map();
      const deduplicated = ranked.filter(({ record }) => {
        const logicalKey = record.type === 'System reference'
          ? `${record.type}:${record.guideId}`
          : `${record.type}:${record.guideId}:${record.headingId}`;
        const guideCount = perGuide.get(record.guideId) || 0;
        if (seen.has(logicalKey) || guideCount >= 3) return false;
        seen.add(logicalKey);
        perGuide.set(record.guideId, guideCount + 1);
        return true;
      });
      if (systemIntent && activeRoute.scope === 'all' && activeRoute.modeId !== 'system') {
        const systemResult = deduplicated.find(({ record }) => record.modeId === 'system');
        if (systemResult) return [...deduplicated.filter(({ record }) => record.modeId !== 'system').slice(0, 7), systemResult];
      }
      return deduplicated.slice(0, 8);
    }

    function openSearchMatches() {
      rankSearchResults().forEach(({ record }) => { if (record.headingId) openContainingDisclosure(document.getElementById(`${record.guideId}-${record.headingId}`)); });
    }

    function renderSearchResults() {
      const results = rankSearchResults();
      const searching = Boolean(normalizeSearchText(activeRoute.query));
      searchResults.replaceChildren();
      searchResults.hidden = !searching;
      panels.forEach((panel) => { panel.hidden = searching || panel.dataset.mode !== activeRoute.modeId; });
      empty.hidden = !searching || results.length !== 0;
      count.textContent = searching ? `${results.length} ${results.length === 1 ? 'result' : 'results'} in ${activeRoute.scope === 'all' ? 'all guides' : 'this mode'}` : 'Choose a guide to read';
      if (noResultSystemLink) noResultSystemLink.href = routeHash({ modeId: 'system', guideId: 'source-references', headingId: null, query: activeRoute.query, scope: 'mode' });
      if (!searching) return;
      results.forEach(({ record, match }) => {
        const result = document.createElement('a');
        result.href = routeHash({ modeId: record.modeId, guideId: record.guideId, headingId: record.headingId, query: activeRoute.query, scope: activeRoute.scope });
        result.dataset.searchResult = '';
        result.dataset.mode = record.modeId;
        result.dataset.guideId = record.guideId;
        result.dataset.tab = record.tabId;
        result.dataset.article = record.articleId;
        result.dataset.resultType = record.type;
        if (record.headingId) result.dataset.heading = `${record.guideId}-${record.headingId}`;
        const location = document.createElement('span');
        location.className = 'search-result-location';
        location.textContent = `${tabs.find((tab) => tab.dataset.mode === record.modeId)?.textContent || record.modeId} / ${record.title}`;
        const heading = document.createElement('strong'); heading.textContent = record.heading;
        const context = document.createElement('small'); context.className = 'search-result-context'; context.textContent = [record.type, record.role ? `Role: ${record.role}` : '', record.module ? `Module: ${record.module}` : ''].filter(Boolean).join(' | ');
        const reason = document.createElement('small'); reason.className = 'search-result-reason';
        const matched = document.createElement('mark'); matched.textContent = activeRoute.query;
        reason.append('Matched ', matched, `: ${match.reason}`);
        const excerpt = document.createElement('small'); excerpt.className = 'search-result-excerpt'; excerpt.textContent = record.excerpt || record.text;
        result.append(location, heading, context, reason, excerpt);
        searchResults.append(result);
      });
    }

    function setSearchState(nextState, { writeHash = false } = {}) {
      const next = {
        modeId: typeof nextState.modeId === 'string' ? nextState.modeId : activeRoute.modeId,
        guideId: nextState.guideId === undefined ? activeRoute.guideId : nextState.guideId,
        headingId: nextState.headingId === undefined ? activeRoute.headingId : nextState.headingId,
        query: String(nextState.query || '').trim(),
        scope: nextState.scope === 'mode' || nextState.scope === 'tab' ? 'mode' : 'all',
      };
      const wasSearching = Boolean(activeRoute.query);
      const isSearching = Boolean(next.query);
      if (!wasSearching && isSearching) captureDisclosureState();
      if (wasSearching && !isSearching) restoreDisclosureState();
      activeRoute = next;
      search.value = next.query;
      searchScopeButtons.forEach((button) => button.setAttribute('aria-pressed', String((button.dataset.searchScope === 'tab' ? 'mode' : button.dataset.searchScope) === next.scope)));
      if (isSearching) openSearchMatches();
      renderSearchResults();
      if (isDrawerViewport() && isSearching && document.activeElement === search) setSearchSurfaceVisible(true);
      if (isDrawerViewport() && !isSearching) setSearchSurfaceVisible(false, { restoreFocus: false });
      if (writeHash) history.replaceState({}, '', routeHash(activeRoute));
      schedulePersistence();
    }

    function updatePageToc(article, headingId) {
      pageToc.replaceChildren();
      if (!article) { pageToc.parentElement.hidden = true; return; }
      const headings = [...article.querySelectorAll('.article-body [data-guide-section] > h2, .article-body details[data-section-id] > summary, .article-body h3')];
      headings.forEach((heading) => {
        const domId = heading.id || heading.parentElement.id;
        const localHeadingId = domId.startsWith(`${article.dataset.guideId}-`) ? domId.slice(article.dataset.guideId.length + 1) : domId;
        const link = document.createElement('a');
        link.href = routeHash({ modeId: article.dataset.mode, guideId: article.dataset.guideId, headingId: localHeadingId, query: activeRoute.query, scope: activeRoute.scope });
        link.dataset.headingLink = ''; link.dataset.mode = article.dataset.mode; link.dataset.guideId = article.dataset.guideId; link.dataset.tab = article.dataset.tab; link.dataset.article = article.id; link.dataset.heading = domId;
        link.className = `toc-level-${heading.tagName.toLowerCase()}`; link.textContent = heading.textContent; link.setAttribute('aria-current', String(localHeadingId === headingId));
        pageToc.append(link);
      });
      const pageTocDrawer = pageToc.parentElement;
      pageTocDrawer.hidden = headings.length === 0 || activeDrawer !== 'toc';
    }

    function routeAnchor({ guideId, headingId }) {
      if (!guideId || !headingId) return null;
      const guide = guides.find((candidate) => candidate.dataset.guideId === guideId);
      const anchor = document.getElementById(`${guideId}-${headingId}`);
      return guide?.contains(anchor) ? anchor : null;
    }

    function isRouteValid({ modeId, guideId, headingId }) {
      if (!modeIds.has(modeId)) return false;
      if (!guideId) return !headingId && modeId !== 'home';
      const guide = guides.find((candidate) => candidate.dataset.guideId === guideId);
      return Boolean(guide && guide.dataset.mode === modeId && (!headingId || routeAnchor({ guideId, headingId })));
    }

    function recoverRoute(route) {
      if (isRouteValid(route)) return route;
      routeNotice.hidden = false;
      routeNotice.querySelector('span').textContent = 'We could not find that handbook destination. Home is open so you can search for the current guide.';
      return { modeId: 'home', guideId: 'home', headingId: null, query: route.query || '', scope: route.scope || 'all' };
    }

    function focusRouteTarget(route) {
      const guide = guides.find((candidate) => candidate.dataset.guideId === route.guideId);
      const anchor = route.headingId ? routeAnchor(route) : guide;
      openContainingDisclosure(anchor);
      if (anchor?.matches('details')) anchor.open = true;
      const target = route.headingId
        ? (anchor?.matches('summary, h1, h2, h3, h4, h5, h6') ? anchor : anchor?.querySelector(':scope > summary, :scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > header > h3'))
        : guide?.querySelector('h1');
      if (!target) return;
      target.tabIndex = -1;
      target.scrollIntoView({ block: 'start', behavior: 'auto' });
      target.focus({ preventScroll: true });
      positionTargetBelowStickyChrome(target);
    }

    function visibleStickyChromeBottom(target) {
      const targetRect = target.getBoundingClientRect();
      return [...document.querySelectorAll('body *')].reduce((bottom, candidate) => {
        if (candidate === target || candidate.contains(target) || !candidate.getClientRects().length) return bottom;
        const style = getComputedStyle(candidate);
        if ((style.position !== 'fixed' && style.position !== 'sticky') || style.visibility === 'hidden' || style.display === 'none') return bottom;
        const rect = candidate.getBoundingClientRect();
        if (rect.height <= 0 || rect.bottom <= 0 || rect.top >= innerHeight || rect.right <= targetRect.left || rect.left >= targetRect.right) return bottom;
        const declaredTop = Number.parseFloat(style.top);
        if (!Number.isFinite(declaredTop) || rect.top > declaredTop + 1) return bottom;
        return Math.max(bottom, rect.bottom);
      }, 0);
    }

    function positionTargetBelowStickyChrome(target) {
      const gap = 16;
      const targetTop = target.getBoundingClientRect().top;
      const desiredTop = visibleStickyChromeBottom(target) + gap;
      if (targetTop < desiredTop || targetTop > desiredTop + 1) window.scrollBy({ left: 0, top: targetTop - desiredTop, behavior: 'auto' });
    }

    function renderRecentGuides() {
      const list = document.querySelector('[data-recent-guides]');
      if (!list) return;
      list.replaceChildren(...recentGuides.map((id) => {
        const guide = guides.find((candidate) => candidate.dataset.guideId === id);
        const item = document.createElement('li');
        if (!guide) return item;
        const link = document.createElement('a');
        link.href = routeHash({ modeId: guide.dataset.mode, guideId: id, headingId: null, query: '', scope: 'all' });
        link.dataset.guideLink = ''; link.dataset.mode = guide.dataset.mode; link.dataset.guideId = id;
        link.textContent = guide.querySelector('h1')?.textContent || id;
        item.append(link);
        return item;
      }));
    }

    function updateRecentGuides(guideId) {
      if (guideId && guideId !== 'home') recentGuides = [guideId, ...recentGuides.filter((id) => id !== guideId)].slice(0, 8);
      renderRecentGuides();
    }

    function activateRoute({ modeId, guideId, headingId, query, scope, historyMode, restoreScroll, focusTarget, showSearchSurface = false }) {
      closeCompactSurface({ restoreFocus: false });
      if (activeRoute.guideId && guides.some((guide) => guide.dataset.guideId === activeRoute.guideId)) guideScroll = { ...guideScroll, [activeRoute.guideId]: window.scrollY };
      const guide = guides.find((candidate) => candidate.dataset.guideId === guideId) || null;
      const article = guide?.matches('article[data-document]') ? guide : null;
      activeRoute = { modeId, guideId: guide?.dataset.guideId || null, headingId: headingId || null, query: String(query || '').trim(), scope: scope === 'mode' || scope === 'tab' ? 'mode' : 'all' };
      search.value = activeRoute.query;
      searchScopeButtons.forEach((button) => button.setAttribute('aria-pressed', String((button.dataset.searchScope === 'tab' ? 'mode' : button.dataset.searchScope) === activeRoute.scope)));
      applyPrintScope(printScope);
      const hash = routeHash(activeRoute);
      tabs.forEach((tab) => { const active = tab.dataset.mode === modeId; tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1; });
      articles.forEach((candidate) => { candidate.hidden = candidate !== article; });
      hero.hidden = guide !== hero; empty.hidden = true;
      articleLinks.forEach((link) => link.setAttribute('aria-current', link.dataset.guideId === guide?.dataset.guideId ? 'page' : 'false'));
      updatePageToc(article, headingId); openContainingDisclosure(routeAnchor(activeRoute)); renderSearchResults(); updateRecentGuides(activeRoute.guideId);
      if (showSearchSurface && activeRoute.query) setSearchSurfaceVisible(true, { restoreFocus: false });
      if (historyMode === 'push') history.pushState({}, '', hash);
      if (historyMode === 'replace') history.replaceState({}, '', hash);
      if (restoreScroll === 'stored') restoreStoredPosition(activeRoute);
      else if (focusTarget) {
        const routeToFocus = { ...activeRoute };
        window.setTimeout(() => {
          if (activeRoute.modeId === routeToFocus.modeId && activeRoute.guideId === routeToFocus.guideId && activeRoute.headingId === routeToFocus.headingId) focusRouteTarget(routeToFocus);
        }, 0);
      }
      schedulePersistence();
    }

    function restoreStoredPosition(route) {
      const heading = route.headingId ? document.getElementById(`${route.guideId}-${route.headingId}`) : null;
      if (heading) { openContainingDisclosure(heading); focusRouteTarget(route); return; }
      window.scrollTo({ left: 0, top: guideScroll[route.guideId] || 0, behavior: 'auto' });
    }

    function activateLinkedRoute(link, restoreScroll) {
      const route = parseRoute(link.getAttribute('href'));
      const recovered = recoverRoute(route);
      if (isRouteValid(route)) routeNotice.hidden = true;
      const isSuggestion = link.matches('[data-search-suggestion]');
      activateRoute({ ...recovered, historyMode: 'push', restoreScroll, focusTarget: !isSuggestion, showSearchSurface: isSuggestion });
      if (isSuggestion) searchResults.querySelector('[data-search-result]')?.focus();
    }

    function activateParsedRoute(historyMode, restoreScroll) {
      const params = new URLSearchParams(location.hash.replace(/^#/, ''));
      const wasLegacy = params.has('tab') || params.has('article');
      const parsedRoute = parseRoute();
      const recovered = recoverRoute(parsedRoute);
      if (wasLegacy && isRouteValid(parsedRoute)) {
        routeNotice.hidden = false;
        routeNotice.querySelector('span').textContent = 'This handbook link has moved. The current guide is open.';
      } else if (isRouteValid(parsedRoute)) routeNotice.hidden = true;
      const hasSavedPosition = restoreScroll === 'stored' && recovered.guideId && Object.prototype.hasOwnProperty.call(guideScroll, recovered.guideId);
      const focusTarget = Boolean(recovered.headingId) || Boolean(recovered.guideId && !hasSavedPosition);
      const canonicalHash = routeHash(recovered);
      activateRoute({ ...recovered, historyMode: location.hash === canonicalHash ? historyMode : 'replace', restoreScroll: hasSavedPosition ? 'stored' : false, focusTarget, showSearchSurface: Boolean(recovered.query) });
      lastHandledHash = location.hash;
    }

    function applyDiagramZoom(shell, scale) {
      const viewport = shell.querySelector('[data-diagram-viewport]');
      const canvas = shell.querySelector('.diagram-canvas');
      const diagram = shell.querySelector('.mermaid');
      const svg = diagram?.querySelector('svg');
      const viewBox = svg?.viewBox?.baseVal;
      const width = viewBox?.width || Number(shell.dataset.diagramWidth);
      const height = viewBox?.height || Number(shell.dataset.diagramHeight);
      if (!viewport || !canvas || !diagram || !svg || !width || !height) return false;
      shell.dataset.diagramWidth = String(width);
      shell.dataset.diagramHeight = String(height);
      const availableWidth = Math.max(1, viewport.clientWidth - 48);
      const availableHeight = Math.max(1, viewport.clientHeight - 48);
      const resolvedScale = scale === 'fit'
        ? Math.min(1.8, Math.max(.6, Math.min(availableWidth / width, availableHeight / height)))
        : Math.min(1.8, Math.max(.6, scale));
      shell.dataset.diagramScale = scale === 'fit' ? 'fit' : String(resolvedScale);
      shell.dataset.diagramRenderedScale = String(resolvedScale);
      canvas.style.width = `${Math.ceil(width * resolvedScale + 48)}px`;
      canvas.style.height = `${Math.ceil(height * resolvedScale + 48)}px`;
      diagram.style.width = `${width}px`;
      diagram.style.height = `${height}px`;
      diagram.style.transform = `translate(24px, 24px) scale(${resolvedScale})`;
      svg.style.width = `${width}px`;
      svg.style.height = `${height}px`;
      svg.style.maxWidth = 'none';
      return true;
    }

    function applyDiagramMode(group, mode) {
      const selected = ['overview', 'role', 'decision'].includes(mode) ? mode : 'overview';
      group.dataset.activeDiagramView = selected;
      group.querySelectorAll('.diagram-shell[data-diagram-view]').forEach((shell) => { shell.hidden = shell.dataset.diagramView !== selected; });
      group.querySelectorAll('[data-diagram-view-control]').forEach((button) => { button.setAttribute('aria-pressed', String(button.dataset.diagramViewControl === selected)); });
      window.requestAnimationFrame(refreshDiagramCanvases);
    }

    function refreshDiagramCanvases() {
      document.querySelectorAll('.diagram-shell[data-diagram-id]').forEach((shell) => {
        if (shell.closest('[hidden]')) return;
        const id = shell.dataset.diagramId;
        if (!applyDiagramZoom(shell, diagramZoom[id] || 'fit')) return;
        const view = diagramViews[id];
        const viewport = shell.querySelector('[data-diagram-viewport]');
        if (view) { viewport.scrollLeft = view.left; viewport.scrollTop = view.top; }
      });
    }

    function prepareMermaidLayout() {
      // Mermaid only needs hidden reading content revealed while it measures diagrams.
      // Do not include header controls: users can interact with them before rendering completes.
      const hiddenElements = [...readingCanvas.querySelectorAll('[hidden]')];
      const closedSections = [...document.querySelectorAll('details:not([open])')];
      hiddenElements.forEach((element) => { element.hidden = false; });
      closedSections.forEach((section) => { section.open = true; });
      return () => {
        hiddenElements.forEach((element) => { element.hidden = true; });
        closedSections.forEach((section) => { section.open = false; });
      };
    }

    applyStoredDisclosures();
    document.documentElement.dataset.theme = restoredState.theme;
    resetDrawers();
    applyPrintScope(printScope);
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => activateRoute({ ...activeRoute, modeId: tab.dataset.mode, guideId: tab.dataset.mode === 'home' ? 'home' : null, headingId: null, historyMode: 'push', restoreScroll: false, focusTarget: false }));
      tab.addEventListener('keydown', (event) => {
        const keyToOffset = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };
        if (event.key === 'Home' || event.key === 'End' || keyToOffset[event.key]) {
          event.preventDefault();
          const targetIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + keyToOffset[event.key] + tabs.length) % tabs.length;
          const target = tabs[targetIndex];
          activateRoute({ ...activeRoute, modeId: target.dataset.mode, guideId: target.dataset.mode === 'home' ? 'home' : null, headingId: null, historyMode: 'push', restoreScroll: false, focusTarget: false });
          target.focus();
        }
      });
    });
    document.addEventListener('click', (event) => {
      const disclosureAction = event.target.closest('button[data-disclosure-action]');
      if (disclosureAction) { const article = disclosureAction.closest('article[data-document]'); article.querySelectorAll('details[data-section-id]').forEach((details) => { details.open = disclosureAction.dataset.disclosureAction === 'expand'; }); syncDisclosureState(); return; }
      if (printMenu && !printMenu.hidden && !event.target.closest('.print-control')) setPrintMenuVisible(false);
      const link = event.target.closest('a[data-search-result], a[data-guide-link], a[data-article-link], a[data-heading-link], a[data-route-link]');
      if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      activateLinkedRoute(link, true);
    });
    document.querySelectorAll('details[data-section-id]').forEach((details) => details.addEventListener('toggle', syncDisclosureState));
    search.addEventListener('input', () => setSearchState({ ...activeRoute, query: search.value }, { writeHash: true }));
    searchScopeButtons.forEach((button) => button.addEventListener('click', () => setSearchState({ ...activeRoute, scope: button.dataset.searchScope }, { writeHash: true })));
    document.querySelector('#theme').addEventListener('click', () => { const root = document.documentElement; root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark'; schedulePersistence(); });
    drawerTriggers.forEach((button) => button.addEventListener('click', () => setDrawerVisible(button.dataset.openDrawer, true)));
    document.querySelectorAll('[data-close-drawer]').forEach((button) => button.addEventListener('click', () => setDrawerVisible(button.dataset.closeDrawer, false)));
    document.querySelectorAll('[data-open-screenshot-surface]').forEach((button) => button.addEventListener('click', () => openCompactSurface(`screenshot:${button.dataset.openScreenshotSurface}`)));
    document.querySelectorAll('[data-close-screenshot-surface]').forEach((button) => button.addEventListener('click', () => closeCompactSurface()));
    function setPrintMenuVisible(visible, { focusOption = false } = {}) {
      if (!printMenu || !printTrigger) return;
      if (isDrawerViewport()) {
        if (visible) openCompactSurface('print');
        else if (activeCompactSurface === 'print') closeCompactSurface();
        return;
      }
      printMenu.hidden = !visible;
      printTrigger.setAttribute('aria-expanded', String(visible));
      if (visible && focusOption) printMenu.querySelector('button')?.focus();
    }
    printTrigger?.addEventListener('click', () => setPrintMenuVisible(printMenu.hidden));
    printTrigger?.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowDown' || !printMenu.hidden) return;
      event.preventDefault();
      setPrintMenuVisible(true, { focusOption: true });
    });
    document.querySelectorAll('button[data-print-scope]').forEach((button) => button.addEventListener('click', () => { applyPrintScope(button.dataset.printScope); setPrintMenuVisible(false); window.print(); }));
    window.addEventListener('beforeprint', () => applyPrintScope(printScope));
    document.querySelector('[data-recovery-search]').addEventListener('click', () => { routeNotice.hidden = true; search.focus(); });
    document.querySelector('[data-dismiss-notice]').addEventListener('click', () => { routeNotice.hidden = true; });
    window.addEventListener('scroll', () => { if (activeRoute.guideId) guideScroll = { ...guideScroll, [activeRoute.guideId]: window.scrollY }; schedulePersistence(); }, { passive: true });
    document.addEventListener('keydown', (event) => {
      if (activeCompactSurface && activeCompactSurface !== 'search') {
        const surface = compactSurfaceElement(activeCompactSurface);
        if (event.key === '/') { event.preventDefault(); return; }
        if (event.key === 'Escape') { event.preventDefault(); closeCompactSurface(); return; }
        if (event.key === 'Tab' && surface) {
          const items = focusableIn(surface); if (!items.length) return;
          const first = items[0]; const last = items[items.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
        return;
      }
      if (event.key === 'Escape' && drawers.contents?.hasAttribute('data-search-surface')) { event.preventDefault(); setSearchSurfaceVisible(false); return; }
      if (event.key === 'Escape' && printMenu && !printMenu.hidden) { event.preventDefault(); setPrintMenuVisible(false); printTrigger?.focus(); return; }
      if (event.key === '/' && !/input|textarea|select/i.test(document.activeElement.tagName)) { event.preventDefault(); search.focus(); }
    });
    document.querySelectorAll('.process-ribbon-viewport').forEach((ribbon) => ribbon.addEventListener('keydown', (event) => {
      const amount = Math.max(120, Math.floor(ribbon.clientWidth * .7));
      if (event.key === 'ArrowRight') { event.preventDefault(); ribbon.scrollBy({ left: amount, behavior: 'smooth' }); }
      if (event.key === 'ArrowLeft') { event.preventDefault(); ribbon.scrollBy({ left: -amount, behavior: 'smooth' }); }
      if (event.key === 'Home') { event.preventDefault(); ribbon.scrollTo({ left: 0, behavior: 'smooth' }); }
      if (event.key === 'End') { event.preventDefault(); ribbon.scrollTo({ left: ribbon.scrollWidth, behavior: 'smooth' }); }
    }));
    document.querySelectorAll('[data-diagram-group]').forEach((group) => {
      const id = group.dataset.diagramGroup;
      group.dataset.pendingDiagramView = diagramModes[id] || 'overview';
      group.querySelectorAll('[data-diagram-view-control]').forEach((button) => button.addEventListener('click', () => {
        const mode = button.dataset.diagramViewControl;
        diagramModes = { ...diagramModes, [id]: mode };
        group.dataset.pendingDiagramView = mode;
        if (diagramsReady) applyDiagramMode(group, mode);
        schedulePersistence();
      }));
    });
    document.querySelectorAll('.diagram-shell[data-diagram-id]').forEach((shell) => {
      const id = shell.dataset.diagramId; const viewport = shell.querySelector('[data-diagram-viewport]'); let scale = diagramZoom[id] || 'fit';
      viewport.addEventListener('scroll', () => { diagramViews = { ...diagramViews, [id]: { left: viewport.scrollLeft, top: viewport.scrollTop } }; schedulePersistence(); });
      shell.querySelector('[data-diagram-fit]')?.addEventListener('click', () => { scale = 'fit'; diagramZoom = { ...diagramZoom, [id]: scale }; applyDiagramZoom(shell, scale); schedulePersistence(); });
      shell.querySelectorAll('[data-diagram-zoom]').forEach((button) => button.addEventListener('click', () => { const action = button.dataset.diagramZoom; const current = typeof scale === 'number' ? scale : 1; scale = action === 'reset' ? 1 : Math.min(1.8, Math.max(.6, current + (action === 'in' ? .1 : -.1))); diagramZoom = { ...diagramZoom, [id]: scale }; applyDiagramZoom(shell, scale); schedulePersistence(); }));
    });
    const restoreMermaidLayout = prepareMermaidLayout();
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base', flowchart: { htmlLabels: true, useMaxWidth: true }, themeVariables: { primaryColor: '#e7f2fb', primaryTextColor: '#17233b', primaryBorderColor: '#0875bd', lineColor: '#506681', secondaryColor: '#e8faf5', tertiaryColor: '#fff4e8', fontFamily: 'Inter, Segoe UI, Arial, sans-serif' } });
    const mermaidReady = mermaid.run({ querySelector: '.mermaid' }).catch((error) => { console.error('Diagram rendering failed', error); });
    let lastHandledHash = location.hash;
    const handleHistoryNavigation = () => {
      if (location.hash === lastHandledHash) return;
      lastHandledHash = location.hash;
      activateParsedRoute('none', 'stored');
    };
    window.addEventListener('popstate', handleHistoryNavigation);
    window.addEventListener('hashchange', handleHistoryNavigation);
    const initialHash = location.hash;
    const initialParams = new URLSearchParams(initialHash.replace(/^#/, ''));
    const initialWasLegacy = initialParams.has('tab') || initialParams.has('article');
    const initialRoute = initialHash ? parseRoute() : restoredState.activeRoute;
    const recoveredInitialRoute = recoverRoute(initialRoute);
    if (initialWasLegacy && isRouteValid(initialRoute)) {
      routeNotice.hidden = false;
      routeNotice.querySelector('span').textContent = 'This handbook link has moved. The current guide is open.';
    } else if (initialHash && isRouteValid(initialRoute)) routeNotice.hidden = true;
    mermaidReady.finally(() => {
      restoreMermaidLayout();
      diagramsReady = true;
      document.querySelectorAll('[data-diagram-group]').forEach((group) => applyDiagramMode(group, group.dataset.pendingDiagramView || 'overview'));
      const hasSavedPosition = recoveredInitialRoute.guideId && Object.prototype.hasOwnProperty.call(guideScroll, recoveredInitialRoute.guideId);
      const focusTarget = Boolean(recoveredInitialRoute.headingId) || Boolean(recoveredInitialRoute.guideId && !hasSavedPosition);
      activateRoute({ ...recoveredInitialRoute, historyMode: 'replace', restoreScroll: hasSavedPosition ? 'stored' : false, focusTarget, showSearchSurface: Boolean(recoveredInitialRoute.query) });
      lastHandledHash = location.hash;
      window.requestAnimationFrame(refreshDiagramCanvases);
    });
    window.addEventListener('resize', () => window.requestAnimationFrame(() => { resetDrawers(); refreshDiagramCanvases(); }), { passive: true });

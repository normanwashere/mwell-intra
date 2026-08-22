    const tabs = [...document.querySelectorAll('[data-tab-button]')];
    const panels = [...document.querySelectorAll('[data-tab-panel]')];
    const articles = [...document.querySelectorAll('[data-document]')];
    const articleLinks = [...document.querySelectorAll('[data-article-link]')];
    const search = document.querySelector('#search');
    const searchResults = document.querySelector('#search-results');
    const searchScopeButtons = [...document.querySelectorAll('[data-search-scope]')];
    const empty = document.querySelector('#empty');
    const count = document.querySelector('#result-count');
    const hero = document.querySelector('.hero');
    const readingCanvas = document.querySelector('.reading-canvas');
    const pageToc = document.querySelector('[data-page-toc]');
    const tabIds = new Set(tabs.map((tab) => tab.dataset.tab));
    const handbookIndex = Array.isArray(window.__HANDBOOK_INDEX__) ? window.__HANDBOOK_INDEX__ : [];
    const configuredSearchState = window.__HANDBOOK_SEARCH_STATE__ || { query: '', scope: 'all' };
    let searchState = { query: '', scope: configuredSearchState.scope === 'tab' ? 'tab' : 'all' };
    let activeRoute = { tabId: 'start', articleId: null, headingId: null };
    let disclosureStateBeforeSearch = null;

    function normalizeSearchText(value) {
      return String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('en-PH');
    }

    function parseRoute(hash = location.hash) {
      const params = new URLSearchParams(hash.replace(/^#/, ''));
      return {
        tabId: params.get('tab') || 'start',
        articleId: params.get('article'),
        headingId: params.get('heading'),
        query: params.get('q') || '',
        scope: params.get('scope') === 'tab' ? 'tab' : 'all',
      };
    }

    function routeHash({ tabId, articleId, headingId }) {
      const params = new URLSearchParams({ tab: tabId });
      const { query, scope } = searchState;
      if (articleId) params.set('article', articleId);
      if (headingId) params.set('heading', headingId);
      if (query) params.set("q", query);
      if (query || scope === 'tab') params.set("scope", scope);
      return `#${params}`;
    }

    function captureDisclosureState() {
      disclosureStateBeforeSearch = new Map([...document.querySelectorAll('details')].map((details) => [details, details.open]));
    }

    function restoreDisclosureState() {
      if (!disclosureStateBeforeSearch) return;
      disclosureStateBeforeSearch.forEach((open, details) => { details.open = open; });
      disclosureStateBeforeSearch = null;
    }

    function openContainingDisclosure(target) {
      for (let ancestor = target?.parentElement; ancestor; ancestor = ancestor.parentElement) {
        if (ancestor.matches('details')) ancestor.open = true;
      }
    }

    function describeMatch(record, query) {
      const fields = {
        title: normalizeSearchText(record.title),
        heading: normalizeSearchText(record.heading),
        keywords: normalizeSearchText((record.keywords || []).join(' ')),
        summary: normalizeSearchText(record.summary),
        audience: normalizeSearchText((record.audience || []).join(' ')),
        source: normalizeSearchText(record.source),
        text: normalizeSearchText(record.text),
      };
      if (fields.title === query) return { rank: 0, reason: 'Exact article title match' };
      if (fields.title.startsWith(query)) return { rank: 1, reason: 'Article title starts with your search' };
      if (fields.heading.includes(query)) return { rank: 2, reason: 'Matching section heading' };
      if (fields.keywords.includes(query)) return { rank: 3, reason: 'Matching handbook keyword' };
      if (fields.summary.includes(query)) return { rank: 4, reason: 'Matching article summary' };
      if (fields.audience.includes(query)) return { rank: 4, reason: 'Matching intended audience' };
      if (fields.source.includes(query)) return { rank: 4, reason: 'Matching source path' };
      if (fields.text.includes(query)) return { rank: 5, reason: 'Matching section text' };
      return null;
    }

    function rankSearchResults() {
      const query = normalizeSearchText(searchState.query);
      if (!query) return [];
      return handbookIndex
        .filter((record) => searchState.scope === 'all' || record.tabId === activeRoute.tabId)
        .map((record, index) => ({ record, index, match: describeMatch(record, query) }))
        .filter(({ match }) => match)
        .sort((left, right) => left.match.rank - right.match.rank || left.index - right.index);
    }

    function renderSearchResults() {
      const results = rankSearchResults();
      const query = normalizeSearchText(searchState.query);
      const searching = Boolean(query);
      searchResults.replaceChildren();
      searchResults.hidden = !searching;
      panels.forEach((panel) => { panel.hidden = searching || panel.id !== `panel-${activeRoute.tabId}`; });
      empty.hidden = !searching || results.length !== 0;
      count.textContent = searching
        ? `${results.length} ${results.length === 1 ? 'result' : 'results'} in ${searchState.scope === 'all' ? 'all tabs' : 'this tab'}`
        : 'Choose an article to read';
      if (!searching) return;

      results.forEach(({ record, match }) => {
        const result = document.createElement('a');
        result.href = routeHash({ tabId: record.tabId, articleId: record.articleId, headingId: record.headingId });
        result.dataset.searchResult = '';
        result.dataset.tab = record.tabId;
        result.dataset.article = record.articleId;
        if (record.headingId) result.dataset.heading = record.headingId;

        const location = document.createElement('span');
        location.className = 'search-result-location';
        location.textContent = `${tabs.find((tab) => tab.dataset.tab === record.tabId)?.textContent || record.tabId} / ${record.title}`;
        const heading = document.createElement('strong');
        heading.textContent = record.heading;
        const reason = document.createElement('small');
        reason.className = 'search-result-reason';
        reason.textContent = match.reason;
        const excerpt = document.createElement('small');
        excerpt.className = 'search-result-excerpt';
        excerpt.textContent = record.text;
        result.append(location, heading, reason, excerpt);
        searchResults.append(result);
      });
    }

    function setSearchState(nextState, { writeHash = false } = {}) {
      const next = {
        query: String(nextState.query || '').trim(),
        scope: nextState.scope === 'tab' ? 'tab' : 'all',
      };
      const wasSearching = Boolean(searchState.query);
      const isSearching = Boolean(next.query);
      if (!wasSearching && isSearching) captureDisclosureState();
      if (wasSearching && !isSearching) restoreDisclosureState();
      searchState = next;
      search.value = next.query;
      searchScopeButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.searchScope === next.scope)));
      renderSearchResults();
      if (writeHash) history.replaceState({}, '', routeHash(activeRoute));
    }

    function updatePageToc(article, headingId) {
      pageToc.replaceChildren();
      if (!article) { pageToc.parentElement.hidden = true; return; }
      const headings = [...article.querySelectorAll('.article-body h2, .article-body h3')];
      headings.forEach((heading) => {
        const link = document.createElement('a');
        link.href = routeHash({ tabId: article.dataset.tab, articleId: article.id, headingId: heading.id });
        link.dataset.headingLink = '';
        link.dataset.tab = article.dataset.tab;
        link.dataset.article = article.id;
        link.dataset.heading = heading.id;
        link.className = `toc-level-${heading.tagName.toLowerCase()}`;
        link.textContent = heading.textContent;
        link.setAttribute('aria-current', String(heading.id === headingId));
        pageToc.append(link);
      });
      pageToc.parentElement.hidden = headings.length === 0;
    }

    function activateRoute({ tabId, articleId, headingId, historyMode, restoreScroll }) {
      const requestedArticle = articles.find((article) => article.id === articleId);
      const article = requestedArticle || null;
      const activeTabId = article ? article.dataset.tab : (tabIds.has(tabId) ? tabId : 'start');
      const heading = article && headingId ? article.querySelector(`#${CSS.escape(headingId)}`) : null;
      const activeHeadingId = heading ? heading.id : null;
      activeRoute = { tabId: activeTabId, articleId: article?.id || null, headingId: activeHeadingId };
      const hash = routeHash(activeRoute);

      tabs.forEach((tab) => {
        const active = tab.dataset.tab === activeTabId;
        tab.setAttribute('aria-selected', String(active));
        tab.tabIndex = active ? 0 : -1;
        if (restoreScroll === 'keyboard' && active) tab.focus();
      });
      articles.forEach((candidate) => { candidate.hidden = candidate !== article; });
      hero.hidden = Boolean(article);
      empty.hidden = true;
      articleLinks.forEach((link) => link.setAttribute('aria-current', link.dataset.article === article?.id ? 'page' : 'false'));
      updatePageToc(article, activeHeadingId);
      openContainingDisclosure(heading);
      renderSearchResults();

      if (historyMode === 'push') history.pushState({}, '', hash);
      if (historyMode === 'replace') history.replaceState({}, '', hash);
      if (restoreScroll === true || restoreScroll === 'keyboard') (heading || article || readingCanvas).scrollIntoView({ block: heading ? 'start' : 'nearest' });
    }

    function activateLinkedRoute(link, restoreScroll) {
      activateRoute({ tabId: link.dataset.tab, articleId: link.dataset.article, headingId: link.dataset.heading, historyMode: 'push', restoreScroll });
    }

    function activateParsedRoute(historyMode, restoreScroll) {
      const route = parseRoute();
      setSearchState(route);
      activateRoute({ ...route, historyMode, restoreScroll });
    }

    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => activateRoute({ tabId: tab.dataset.tab, articleId: null, headingId: null, historyMode: 'push', restoreScroll: false }));
      tab.addEventListener('keydown', (event) => {
        const keyToOffset = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };
        if (event.key === 'Home' || event.key === 'End' || keyToOffset[event.key]) {
          event.preventDefault();
          const targetIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + keyToOffset[event.key] + tabs.length) % tabs.length;
          activateRoute({ tabId: tabs[targetIndex].dataset.tab, articleId: null, headingId: null, historyMode: 'push', restoreScroll: 'keyboard' });
        }
      });
    });

    document.addEventListener('click', (event) => {
      const link = event.target.closest('a[data-search-result], a[data-article-link], a[data-heading-link], a[data-route-link]');
      if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (link.matches('[data-route-link]')) {
        const route = parseRoute(link.getAttribute('href'));
        activateRoute({ ...route, historyMode: 'push', restoreScroll: event.detail === 0 ? 'keyboard' : true });
        return;
      }
      activateLinkedRoute(link, event.detail === 0 ? 'keyboard' : true);
    });

    search.addEventListener('input', () => setSearchState({ query: search.value, scope: searchState.scope }, { writeHash: true }));
    searchScopeButtons.forEach((button) => button.addEventListener('click', () => setSearchState({ query: searchState.query, scope: button.dataset.searchScope }, { writeHash: true })));
    document.querySelector('#theme').addEventListener('click', () => {
      const root = document.documentElement;
      root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem('mwell-doc-theme', root.dataset.theme);
    });
    document.documentElement.dataset.theme = localStorage.getItem('mwell-doc-theme') || 'light';
    document.addEventListener('keydown', (event) => {
      if (event.key === '/' && !/input|textarea|select/i.test(document.activeElement.tagName)) { event.preventDefault(); search.focus(); }
    });
    document.querySelectorAll('.diagram-shell').forEach((shell) => {
      let scale = 1;
      const diagram = shell.querySelector('.mermaid');
      const baseMin = matchMedia('(max-width:520px)').matches ? 520 : 720;
      shell.querySelectorAll('[data-diagram-zoom]').forEach((button) => button.addEventListener('click', () => {
        const action = button.dataset.diagramZoom;
        scale = action === 'reset' ? 1 : Math.min(1.8, Math.max(.6, scale + (action === 'in' ? .1 : -.1)));
        diagram.style.width = `${scale * 100}%`;
        diagram.style.minWidth = `${baseMin * scale}px`;
      }));
    });
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base', flowchart: { htmlLabels: true, useMaxWidth: true }, themeVariables: { primaryColor: '#e7f2fb', primaryTextColor: '#17233b', primaryBorderColor: '#0875bd', lineColor: '#506681', secondaryColor: '#e8faf5', tertiaryColor: '#fff4e8', fontFamily: 'Inter, Segoe UI, Arial, sans-serif' } });
    mermaid.run({ querySelector: '.mermaid' }).catch((error) => { console.error('Diagram rendering failed', error); });
    window.addEventListener('popstate', () => activateParsedRoute('none', false));
    window.addEventListener('hashchange', () => activateParsedRoute('none', false));
    const initialRoute = parseRoute();
    setSearchState(initialRoute);
    activateRoute({ ...initialRoute, historyMode: 'replace', restoreScroll: false });

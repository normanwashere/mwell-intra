    const tabs = [...document.querySelectorAll('[data-tab-button]')];
    const panels = [...document.querySelectorAll('[data-tab-panel]')];
    const articles = [...document.querySelectorAll('[data-document]')];
    const articleLinks = [...document.querySelectorAll('[data-article-link]')];
    const contentsRail = document.querySelector('.contents-rail');
    const search = document.querySelector('#search');
    const empty = document.querySelector('#empty');
    const count = document.querySelector('#result-count');
    const hero = document.querySelector('.hero');
    const readingCanvas = document.querySelector('.reading-canvas');
    const pageToc = document.querySelector('[data-page-toc]');
    const tabIds = new Set(tabs.map((tab) => tab.dataset.tab));

    function parseRoute(hash = location.hash) {
      const params = new URLSearchParams(hash.replace(/^#/, ""));
      return { tabId: params.get("tab") || "start", articleId: params.get("article"), headingId: params.get("heading") };
    }

    function routeHash({ tabId, articleId, headingId }) {
      const params = new URLSearchParams({ tab: tabId });
      if (articleId) params.set("article", articleId);
      if (headingId) params.set("heading", headingId);
      return `#${params}`;
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
      const hash = routeHash({ tabId: activeTabId, articleId: article?.id, headingId: activeHeadingId });

      tabs.forEach((tab) => {
        const active = tab.dataset.tab === activeTabId;
        tab.setAttribute('aria-selected', String(active));
        tab.tabIndex = active ? 0 : -1;
        if (restoreScroll === 'keyboard' && active) tab.focus();
      });
      panels.forEach((panel) => { panel.hidden = panel.id !== `panel-${activeTabId}`; });
      articles.forEach((candidate) => { candidate.hidden = candidate !== article; });
      hero.hidden = Boolean(article);
      empty.hidden = true;
      articleLinks.forEach((link) => link.setAttribute('aria-current', link.dataset.article === article?.id ? 'page' : 'false'));
      updatePageToc(article, activeHeadingId);

      if (historyMode === 'push') history.pushState({}, '', hash);
      if (historyMode === 'replace') history.replaceState({}, '', hash);
      if (restoreScroll === true || restoreScroll === 'keyboard') (heading || article || readingCanvas).scrollIntoView({ block: heading ? 'start' : 'nearest' });
    }

    function activateLinkedRoute(link, restoreScroll) {
      activateRoute({ tabId: link.dataset.tab, articleId: link.dataset.article, headingId: link.dataset.heading, historyMode: 'push', restoreScroll });
    }

    function filterArticles() {
      const query = search.value.trim().toLowerCase();
      const primaryLinks = [...contentsRail.querySelectorAll('[data-article-link]:not([data-related-link])')];
      const matchedIds = new Set();
      primaryLinks.forEach((link) => {
        const matches = !query || `${link.dataset.title} ${link.dataset.summary} ${link.dataset.audience} ${link.dataset.contentType}`.toLowerCase().includes(query);
        link.hidden = !matches;
        if (matches) matchedIds.add(link.dataset.article);
      });
      contentsRail.querySelectorAll('[data-related-link]').forEach((link) => {
        link.hidden = Boolean(query) && !`${link.dataset.title} ${link.dataset.summary} ${link.dataset.audience} ${link.dataset.contentType}`.toLowerCase().includes(query);
      });
      empty.hidden = matchedIds.size !== 0;
      count.textContent = query ? `Showing ${matchedIds.size} matching documents` : 'Choose an article to read';
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
      const link = event.target.closest('a[data-article-link], a[data-heading-link], a[data-route-link]');
      if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (link.matches('[data-route-link]')) {
        const route = parseRoute(link.getAttribute('href'));
        activateRoute({ ...route, historyMode: 'push', restoreScroll: event.detail === 0 ? 'keyboard' : true });
        return;
      }
      activateLinkedRoute(link, event.detail === 0 ? 'keyboard' : true);
    });

    search.addEventListener('input', filterArticles);
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
    window.addEventListener('popstate', () => activateRoute({ ...parseRoute(), historyMode: 'none', restoreScroll: false }));
    window.addEventListener('hashchange', () => activateRoute({ ...parseRoute(), historyMode: 'none', restoreScroll: false }));
    filterArticles();
    activateRoute({ ...parseRoute(), historyMode: 'replace', restoreScroll: false });

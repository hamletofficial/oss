(() => {
  'use strict';
  // The 404 page uses a legacy input ID; support it without changing its layout.
  const form = document.getElementById('site-search-form');
  const input = document.getElementById('site-search-input') || document.getElementById('site-search');
  // Reuse the content-versioned script URL for the generated index.
  const assetVersion = (() => {
    try {
      const src = document.currentScript && document.currentScript.src;
      return src ? (new URL(src, window.location.href).searchParams.get('v') || '20261025') : '20261025';
    } catch (_) { return '20261025'; }
  })();
  const suggestions = document.getElementById('site-search-results');
  const pageResults = document.getElementById('search-page-results');
  const pageQuery = document.getElementById('search-page-query');
  const pageCount = document.getElementById('search-page-count');
  const searchIn = document.getElementById('search-in');
  const searchArea = document.getElementById('search-area');
  const searchSort = document.getElementById('search-sort');
  const searchExact = document.getElementById('search-exact');
  const advancedSearch = document.getElementById('advanced-search');
  const resetOptions = document.getElementById('search-reset');
  const applyOptions = document.getElementById('advanced-apply');
  
  // Brand consistency: the homepage is intentionally excluded from this wordmark treatment.
  function applyHamletWordmarkDot() {
    if (window.location.pathname === '/' || window.location.pathname === '/index.html') return;
    document.querySelectorAll('a.brand, a.sector-brand, a.search-brand, .brand-wordmark').forEach(el => {
      if (!/^hamlet$/i.test((el.childNodes[0]?.textContent || '').trim()) && !/^hamlet(?:\\s|$)/i.test(el.textContent.trim())) return;
      const existingDot = Array.from(el.querySelectorAll('span')).find(span => span.textContent.trim() === '.');
      if (existingDot) {
        existingDot.classList.add('brand-dot');
        return;
      }
      if (el.querySelector('.brand-dot')) return;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (/hamlet/i.test(node.nodeValue)) {
          node.nodeValue = node.nodeValue.replace(/hamlet/i, 'hamlet');
          const dot = document.createElement('span');
          dot.className = 'brand-dot';
          dot.textContent = '.';
          dot.style.color = '#bfdbfe';
          node.parentNode.insertBefore(dot, node.nextSibling);
          break;
        }
      }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyHamletWordmarkDot, { once: true });
  else applyHamletWordmarkDot();

  // Public-page analytics only: keep authenticated workspaces, member-only pages,
  // and account routes out even if this shared script is included there by mistake.
  const analyticsPrivateFiles = new Set([
    'archive.html', 'dashboard.html', 'live.html', 'portfolio.html',
    'residential.html', 'resi-resources.html', 'resources.html', 'members.html',
    'directory.html', 'profile.html', 'editprofile.html', 'posts.html',
    'rankings.html', 'messages.html', 'requests.html', 'settings.html',
    'admin.html', 'login.html', 'invoice.html', 'loggedout.html',
    'callback.html', 'success.html', 'insights.html', 'search.html'
  ]);
  const analyticsPrivateDirs = /^(?:app|functions|public|superuser|admin|account|accounts|auth|authentication|onfido|oauth)(?:\/|$)/i;
  function isPublicAnalyticsPath() {
    const path = String(window.location.pathname || '/').replace(/^\/+/, '');
    return !analyticsPrivateFiles.has(path.split('/').pop().toLowerCase())
      && !analyticsPrivateDirs.test(path);
  }

  // Record meaningful search/filter values after typing pauses, deduplicating
  // repeated pauses on the same value. The public-site form has its own submit logger.
  const searchInputTimers = new WeakMap();
  const loggedSearchValues = new WeakMap();
  async function recordSearchEvent(rawQuery, area) {
    if (!isPublicAnalyticsPath()) return;
    const query = String(rawQuery || '').trim().toLocaleLowerCase()
      .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[email]')
      .replace(/\b\d{6,}\b/g, '[number]').slice(0, 100);
    if (query.length < 2) return;
    try {
      await ensureSearchAnalyticsFirebase();
      const auth = firebase.auth();
      await firebase.firestore().collection('searchAnalyticsEvents').add({
        query, area: String(area || 'page-search').slice(0, 80),
        path: String(window.location.pathname || '/').slice(0, 160),
        uid: auth.currentUser ? auth.currentUser.uid : null,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (error) { console.debug('Search analytics event was not recorded:', error && (error.code || error.message)); }
  }
  document.addEventListener('input', event => {
    if (!isPublicAnalyticsPath()) return;
    const field = event.target;
    if (!(field instanceof HTMLInputElement) && !(field instanceof HTMLTextAreaElement)) return;
    if (field.id === 'site-search-input' || field.id === 'site-search') return;
    const label = [field.id, field.name, field.getAttribute('aria-label'), field.placeholder].join(' ').toLowerCase();
    if (!/search|filter/.test(label) && field.type !== 'search') return;
    if (searchInputTimers.has(field)) clearTimeout(searchInputTimers.get(field));
    const timer = setTimeout(() => {
      const value = field.value.trim();
      const signature = value.toLocaleLowerCase();
      if (value.length < 2 || loggedSearchValues.get(field) === signature) return;
      loggedSearchValues.set(field, signature);
      recordSearchEvent(value, field.id || field.name || 'page-search');
    }, 900);
    searchInputTimers.set(field, timer);
  }, true);

  if (!form || !input) return;

  let pages = [];
  let indexPromise;
  const normalise = value => String(value || '').toLocaleLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const escapeHtml = value => String(value || '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const termsFor = query => normalise(query).trim().split(/\s+/).filter(Boolean);

  function loadIndex() {
    if (!indexPromise) {
      const privateFiles = new Set([
        'archive.html', 'dashboard.html', 'live.html', 'portfolio.html',
        'residential.html', 'resi-resources.html', 'resources.html', 'members.html',
        'directory.html', 'profile.html', 'editprofile.html', 'posts.html',
        'rankings.html', 'messages.html', 'requests.html', 'settings.html',
        'admin.html', 'login.html', 'invoice.html', 'loggedout.html',
        'callback.html', 'success.html'
      ]);
      const privateDirs = /^(?:app|functions|public|superuser|admin|account|accounts|auth|authentication)(?:\/|$)/i;
      const filterPublicIndex = data => {
        if (!Array.isArray(data)) throw new Error('Search index has an invalid format');
        return data.filter(page => {
          const searchableText = [page.title, page.path, page.url, page.text].join(' ').toLocaleLowerCase();
          const path = String(page.path || page.url || '').replace(/^\/+/, '');
          const filename = path.split('/').pop().toLowerCase();
          return !/loading\s+search\s+index/.test(searchableText)
            && filename !== '404.html'
            && !privateFiles.has(filename)
            && !privateDirs.test(path);
        });
      };
      const fetchIndexFrom = async url => {
        const response = await fetch(url, {
          cache: 'no-store',
          credentials: 'omit',
          headers: { 'Accept': 'application/json' }
        });
        if (!response.ok) throw new Error('Search index returned HTTP ' + response.status);
        return filterPublicIndex(await response.json());
      };
      indexPromise = (async () => {
        // Read the canonical index committed to GitHub first, bypassing any
        // custom-domain/CDN rule that might reject JSON on the website host.
        const urls = [
          'https://raw.githubusercontent.com/hamletofficial/oss/main/search-index.json?cb=' + Date.now(),
          '/search-index.json?v=' + encodeURIComponent(assetVersion) + '&cb=' + Date.now()
        ];
        let lastError;
        for (const url of urls) {
          try {
            const data = await fetchIndexFrom(url);
            if (!data.length) throw new Error('Search index contained no public pages');
            pages = data;
            return pages;
          } catch (error) {
            lastError = error;
          }
        }
        throw lastError || new Error('Search index could not be loaded');
      })().catch(() => {
        indexPromise = null;
        throw new Error('Search is temporarily unavailable. Please try again shortly.');
      });
    }
    return indexPromise;
  }

  function currentOptions() {
    return {
      in: searchIn ? searchIn.value : 'all',
      area: searchArea ? searchArea.value : 'all',
      sort: searchSort ? searchSort.value : 'relevance',
      exact: Boolean(searchExact && searchExact.checked)
    };
  }

  function areaMatches(page, area) {
    if (area === 'all') return true;
    const path = normalise(page.path || page.url).replace(/^\/+/, '');
    if (area === 'workspace') return /^(app|workspace)(\/|$)/.test(path) || /hamlet\/(workspace|app)/.test(path);
    if (area === 'support') return /(^|\/)(support|docs|documentation)(\/|$)/.test(path) || /support|documentation/.test(normalise(page.title));
    return !/^(app|workspace|support|docs|documentation|superuser|admin|account|auth|login)(\/|$)/.test(path);
  }

  function rankPages(query, options = currentOptions(), allowPartial = false) {
    const terms = termsFor(query);
    if (!terms.length) return [];
    const phrase = normalise(query).trim();
    return pages.map(page => {
      if (!areaMatches(page, options.area)) return null;
      const title = normalise(page.title);
      const path = normalise(page.path || page.url);
      const text = normalise(page.text);
      const searchable = options.in === 'title' ? title : options.in === 'content' ? text : options.in === 'path' ? path : title + ' ' + path + ' ' + text;
      if (options.exact && !searchable.includes(phrase)) return null;
      let score = 0;
      let matchedTerms = 0;
      for (const term of terms) {
        const titleHit = title.includes(term);
        const pathHit = path.includes(term);
        const textHit = text.includes(term);
        const fieldHit = searchable.includes(term);
        if (!fieldHit) {
          if (allowPartial) continue;
          return null;
        }
        matchedTerms++;
        if (options.in === 'all' || options.in === 'title') {
          if (titleHit) score += title === term ? 16 : title.startsWith(term) ? 10 : 7;
        }
        if ((options.in === 'all' || options.in === 'path') && pathHit) score += 5;
        if ((options.in === 'all' || options.in === 'content') && textHit) score += 2;
      }
      if (!matchedTerms) return null;
      if (terms.length > 1 && matchedTerms === terms.length && terms.every(term => title.includes(term))) score += 6;
      if (options.exact) score += 20;
      return {page, score, matchedTerms};
    }).filter(Boolean).sort((a,b) => options.sort === 'title'
      ? a.page.title.localeCompare(b.page.title)
      : b.matchedTerms-a.matchedTerms || b.score-a.score || a.page.title.localeCompare(b.page.title));
  }

  function renderSuggestions(items, message) {
    if (!suggestions) return;
    if (message) {
      suggestions.innerHTML = '<div class="site-search-empty">' + escapeHtml(message) + '</div>';
    } else if (!items.length) {
      suggestions.innerHTML = '<div class="site-search-empty">No matching pages found.</div>';
    } else {
      suggestions.innerHTML = items.slice(0,7).map(({page}) =>
        '<a class="site-search-result" role="option" href="' + escapeHtml(page.url) + '"><strong>' + escapeHtml(page.title) + '</strong><small>' + escapeHtml(page.path || page.url) + '</small></a>'
      ).join('');
    }
    suggestions.hidden = false;
    input.setAttribute('aria-expanded','true');
  }

  function closeSuggestions() {
    if (suggestions) suggestions.hidden = true;
    input.setAttribute('aria-expanded','false');
  }

  async function updateSuggestions(attempt = 0) {
    const query = input.value.trim();
    if (query.length < 2) { closeSuggestions(); return; }
    try {
      await loadIndex();
      // Ignore stale responses if the user has changed the query while loading.
      if (input.value.trim() !== query) return;
      renderSuggestions(rankPages(query));
    } catch (error) {
      if (attempt < 2) {
        renderSuggestions([], 'Search is temporarily unavailable. Retrying…');
        window.setTimeout(() => {
          if (input.value.trim() === query) updateSuggestions(attempt + 1);
        }, 900 * (attempt + 1));
        return;
      }
      renderSuggestions([], error.message || 'Search is temporarily unavailable. Please try again shortly.');
      if (suggestions) {
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'site-search-retry';
        retry.textContent = 'Try again';
        retry.addEventListener('click', () => {
          indexPromise = null;
          updateSuggestions();
        });
        suggestions.appendChild(retry);
      }
    }
  }

  input.addEventListener('input', updateSuggestions);
  input.addEventListener('focus', () => { if (input.value.trim().length >= 2) updateSuggestions(); });
  document.addEventListener('click', event => {
    if (!event.target.closest('.site-search')) closeSuggestions();
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeSuggestions();
    if (event.key === 'ArrowDown' && suggestions && !suggestions.hidden) {
      const first = suggestions.querySelector('a');
      if (first) { event.preventDefault(); first.focus(); }
    }
  });
  async function ensureSearchAnalyticsFirebase() {
    if (window.__hamletAnalyticsFirebasePromise) return window.__hamletAnalyticsFirebasePromise;
    window.__hamletAnalyticsFirebasePromise = (async function() {
      function load(src) { return new Promise(function(resolve,reject) {
        var absolute = new URL(src, location.href).href;
        var found = Array.from(document.scripts).find(function(el){return el.src===absolute});
        if(found){if((src.indexOf('firebase-config.js')>=0&&window.firebaseConfig)||(src.indexOf('firebase-app-compat.js')>=0&&window.firebase&&firebase.apps)||(src.indexOf('firebase-auth-compat.js')>=0&&window.firebase&&firebase.auth)||(src.indexOf('firebase-firestore-compat.js')>=0&&window.firebase&&firebase.firestore))return resolve();found.addEventListener('load',resolve,{once:true});found.addEventListener('error',reject,{once:true});return;}
        var el=document.createElement('script');el.src=src;el.async=true;el.onload=resolve;el.onerror=reject;document.head.appendChild(el);
      });}
      if(!window.firebase||!firebase.apps)await load('https://www.gstatic.com/firebasejs/9.22.2/firebase-app-compat.js');
      if(!window.firebase||!firebase.auth)await load('https://www.gstatic.com/firebasejs/9.22.2/firebase-auth-compat.js');
      if(!window.firebase||!firebase.firestore)await load('https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore-compat.js');
      if(!window.firebaseConfig)await load('/firebase-config.js');
      if(!window.firebase||!window.firebaseConfig)throw new Error('Firebase configuration unavailable');
      if(!firebase.apps.length)firebase.initializeApp(window.firebaseConfig);
    })().catch(function(e){window.__hamletAnalyticsFirebasePromise=null;throw e;});
    return window.__hamletAnalyticsFirebasePromise;
  }
  async function recordHamletSearch(rawQuery, area) {
    if (!isPublicAnalyticsPath()) return;
    const query = String(rawQuery || '').trim().toLocaleLowerCase().replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[email]').replace(/\b\d{6,}\b/g, '[number]').slice(0, 100);
    if (query.length < 2) return;
    try {
      await ensureSearchAnalyticsFirebase();
      const auth = firebase.auth();
      await firebase.firestore().collection('searchAnalyticsEvents').add({
        query, area: String(area || 'public').slice(0, 80),
        path: String(location.pathname || '/').slice(0, 160),
        uid: auth.currentUser ? auth.currentUser.uid : null,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (error) { console.debug('Search analytics event was not recorded:', error && (error.code || error.message)); }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const query = input.value.trim();
    if (query.length < 2) { input.focus(); return; }
    await recordHamletSearch(query, 'public-site');
    window.location.href = '/search.html?q=' + encodeURIComponent(query);
  });

  if (pageResults) {
    const params = new URLSearchParams(window.location.search);
    const query = params.get('q') || '';
    input.value = query;
    if (searchIn && ['all','title','content','path'].includes(params.get('in'))) searchIn.value = params.get('in');
    if (searchArea && ['all','main','workspace','support'].includes(params.get('area'))) searchArea.value = params.get('area');
    if (searchSort && ['relevance','title'].includes(params.get('sort'))) searchSort.value = params.get('sort');
    if (searchExact) searchExact.checked = params.get('exact') === '1';
    if (advancedSearch && (params.has('in') || params.has('area') || params.has('sort') || params.has('exact'))) advancedSearch.open = true;
    if (pageQuery) pageQuery.textContent = query ? 'Results for “' + query + '”' : 'Search all Hamlet pages';
    (async () => {
      if (query.trim().length < 2) {
        if (pageCount) pageCount.textContent = 'Enter at least two characters to search.';
        pageResults.innerHTML = '';
        return;
      }
      try {
        await loadIndex();
        const options = currentOptions();
        let results = rankPages(query, options);
        let partialMatches = false;
        // The full results page should still be useful when a natural-language
        // query contains words absent from every individual page. Keep exact-phrase
        // mode strict, but otherwise fall back to pages matching the most terms.
        if (!results.length && !options.exact) {
          results = rankPages(query, options, true);
          partialMatches = results.length > 0;
        }
        if (pageCount) {
          pageCount.textContent = results.length + (results.length === 1 ? ' page found' : ' pages found')
            + (options.exact ? ' · exact phrase' : '')
            + (partialMatches ? ' · showing closest matches to your terms' : '');
        }
        pageResults.innerHTML = results.length ? results.map(({page}) =>
          '<a class="search-page-result" href="' + escapeHtml(page.url) + '"><span class="search-page-result-title">' + escapeHtml(page.title) + '</span><span class="search-page-result-path">' + escapeHtml(page.path || page.url) + '</span><span class="search-page-result-excerpt">' + escapeHtml(makeExcerpt(page.text, termsFor(query))) + '</span></a>'
        ).join('') : '<p class="search-page-empty">No matching pages found. Try a different word or phrase.</p>';
      } catch (error) {
        if (pageCount) pageCount.textContent = error.message;
        pageResults.innerHTML = '';
      }
    })();
  }

  function submitAdvancedSearch() {
    const query = input.value.trim();
    if (query.length < 2) { input.focus(); return; }
    const options = currentOptions();
    const params = new URLSearchParams({q:query, in:options.in, area:options.area, sort:options.sort});
    if (options.exact) params.set('exact','1');
    window.location.href = '/search.html?' + params.toString();
  }

  if (applyOptions) applyOptions.addEventListener('click', submitAdvancedSearch);
  if (resetOptions) resetOptions.addEventListener('click', () => {
    if (searchIn) searchIn.value = 'all';
    if (searchArea) searchArea.value = 'all';
    if (searchSort) searchSort.value = 'relevance';
    if (searchExact) searchExact.checked = false;
    if (advancedSearch) advancedSearch.open = true;
  });

  function makeExcerpt(text, terms) {
    const source = String(text || '').replace(/\s+/g,' ').trim();
    const lower = normalise(source);
    let position = -1;
    for (const term of terms) {
      const found = lower.indexOf(term);
      if (found >= 0 && (position < 0 || found < position)) position = found;
    }
    if (position < 0) return source.slice(0,190) + (source.length > 190 ? '…' : '');
    const start = Math.max(0, position - 70);
    const end = Math.min(source.length, position + 150);
    return (start ? '…' : '') + source.slice(start,end) + (end < source.length ? '…' : '');
  }
})();
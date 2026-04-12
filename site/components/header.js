import { LANGS, t, getLang, setLang, applyAll } from '/components/i18n.js';

export function renderHeader() {
  // ── Nav bar ──
  const nav = document.createElement('nav');
  nav.className = 'nav';
  nav.innerHTML = `
    <a href="/" class="nav-logo">
      <img src="/icons/icon.svg" alt="">
      Agent<span class="brand">Limb</span>
    </a>
    <ul class="nav-center">
      <li><a href="/#features" data-i18n="nav.features">${t('nav.features')}</a></li>
      <li><a href="/tutorials.html" data-i18n="nav.tutorials">${t('nav.tutorials')}</a></li>
      <li><a href="/muscles.html" data-i18n="store.title">${t('store.title')}</a></li>
      <li><a href="/tools.html" data-i18n="nav.tools">${t('nav.tools')}</a></li>
      <li><a href="/news.html" data-i18n="nav.news">${t('nav.news')}</a></li>
    </ul>
    <div class="nav-right">
      <div class="lang-dropdown" id="lang-dropdown">
        <button class="lang-switch" id="lang-toggle">${currentFlag()}</button>
        <div class="lang-menu hidden" id="lang-menu">
          ${LANGS.map(l => `<button class="lang-option" data-code="${l.code}">${l.flag} ${l.name}</button>`).join('')}
        </div>
      </div>
      <button class="theme-toggle" id="theme-toggle" title="Toggle theme">🌙</button>
      <a href="https://github.com/hooosberg/AgentLimb" class="nav-link" title="Star us on GitHub">⭐ GitHub</a>
      <button class="mobile-menu-btn" id="mobile-menu-btn" aria-label="Menu">
        <span></span><span></span><span></span>
      </button>
    </div>
  `;
  document.body.prepend(nav);

  // ── Mobile dropdown (separate element, sits BEHIND nav bar) ──
  const mobileMenu = document.createElement('div');
  mobileMenu.className = 'mobile-dropdown';
  mobileMenu.id = 'mobile-dropdown';
  mobileMenu.innerHTML = `
    <a href="/#features" data-i18n="nav.features">${t('nav.features')}</a>
    <a href="/tutorials.html" data-i18n="nav.tutorials">${t('nav.tutorials')}</a>
    <a href="/muscles.html" data-i18n="store.title">${t('store.title')}</a>
    <a href="/tools.html" data-i18n="nav.tools">${t('nav.tools')}</a>
    <a href="/news.html" data-i18n="nav.news">${t('nav.news')}</a>
  `;
  nav.after(mobileMenu);

  // Mobile menu toggle
  const menuBtn = document.getElementById('mobile-menu-btn');

  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    mobileMenu.classList.toggle('open');
    menuBtn.classList.toggle('active');
  });

  document.addEventListener('click', () => {
    mobileMenu.classList.remove('open');
    menuBtn.classList.remove('active');
  });

  mobileMenu.addEventListener('click', () => {
    mobileMenu.classList.remove('open');
    menuBtn.classList.remove('active');
  });

  // Theme toggle
  const themeBtn = document.getElementById('theme-toggle');
  const saved = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
  themeBtn.textContent = saved === 'dark' ? '☀️' : '🌙';

  themeBtn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    themeBtn.textContent = next === 'dark' ? '☀️' : '🌙';
  });

  // Language dropdown
  const langBtn = document.getElementById('lang-toggle');
  const langMenu = document.getElementById('lang-menu');

  langBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    langMenu.classList.toggle('hidden');
  });

  document.addEventListener('click', () => langMenu.classList.add('hidden'));

  langMenu.querySelectorAll('.lang-option').forEach(opt => {
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      const code = opt.dataset.code;
      setLang(code);
      location.reload();
    });
  });

  applyAll();
}

function currentFlag() {
  const lang = getLang();
  const found = LANGS.find(l => l.code === lang);
  return found ? found.flag : '🌐';
}

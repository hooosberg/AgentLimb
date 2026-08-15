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
      <a href="https://github.com/hooosberg/AgentLimb" class="nav-link nav-github" title="Star us on GitHub"><svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/></svg></a>
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

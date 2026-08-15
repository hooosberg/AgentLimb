import { t, applyAll } from '/components/i18n.js';

const CHROME_STORE_URL = 'https://chromewebstore.google.com/detail/agentlimb/hldldfepjhljhbcneojddjkkodkjglof';

export function renderFooter(style = 'full') {
  const footer = document.createElement('footer');
  footer.className = 'footer';

  if (style === 'full') {
    footer.innerHTML = `
      <div class="footer-more-works">
        <h3 class="footer-more-works-title">More Works</h3>
        <p class="footer-more-works-sub">Creative tools from the same developer</p>
        <div class="footer-more-works-grid">
          <a href="https://hooosberg.github.io/BeRaw/" target="_blank" rel="noopener" class="footer-more-works-card">
            <img src="https://hooosberg.github.io/BeRaw/assets/icon-128.png" alt="BeRaw" loading="lazy">
            <span>BeRaw</span>
          </a>
          <a href="https://hooosberg.github.io/Packpour/" target="_blank" rel="noopener" class="footer-more-works-card">
            <img src="https://hooosberg.github.io/Packpour/assets/icon-128.png" alt="Packpour" loading="lazy">
            <span>Packpour</span>
          </a>
          <a href="https://hooosberg.github.io/WitNote/" target="_blank" rel="noopener" class="footer-more-works-card">
            <img src="https://hooosberg.github.io/WitNote/assets/icon.png" alt="WitNote" loading="lazy">
            <span>WitNote</span>
          </a>
          <a href="https://hooosberg.github.io/GlotShot/" target="_blank" rel="noopener" class="footer-more-works-card">
            <img src="https://hooosberg.github.io/GlotShot/public/icon/icon-128.png" alt="GlotShot" loading="lazy">
            <span>GlotShot</span>
          </a>
          <a href="https://hooosberg.github.io/TrekReel/" target="_blank" rel="noopener" class="footer-more-works-card">
            <img src="https://hooosberg.github.io/TrekReel/Apple/icon-128.png" alt="TrekReel" loading="lazy">
            <span>TrekReel</span>
          </a>
          <a href="https://hooosberg.github.io/DOMPrompter/" target="_blank" rel="noopener" class="footer-more-works-card">
            <img src="https://hooosberg.github.io/DOMPrompter/pages/img/icon-128.png" alt="DOMPrompter" loading="lazy">
            <span>DOMPrompter</span>
          </a>
          <a href="https://uixskills.com" target="_blank" rel="noopener" class="footer-more-works-card">
            <img src="https://uixskills.com/icons/uixskillicon.png" alt="UIXskills" loading="lazy">
            <span>UIXskills</span>
          </a>
        </div>
      </div>
      <div class="footer-inner">
        <div>
          <div class="footer-brand">
            <img src="/icons/icon.svg" alt="">
            <span>AgentLimb</span>
          </div>
          <p class="footer-tagline" data-i18n="footer.tagline">Give your AI a browser arm.<br>Minimal tools, maximum leverage.</p>
        </div>
        <div class="footer-cols">
          <div class="footer-col">
            <h4 data-i18n="footer.product">Product</h4>
            <ul>
              <li><a href="/#features" data-i18n="nav.features">Features</a></li>
              <li><a href="/#get-started" data-i18n="start.label">Get Started</a></li>
              <li><a href="${CHROME_STORE_URL}">Chrome Web Store</a></li>
            </ul>
          </div>
          <div class="footer-col">
            <h4 data-i18n="footer.resources">Resources</h4>
            <ul>
              <li><a href="https://github.com/hooosberg/AgentLimb">GitHub</a></li>
              <li><a href="/tutorials.html" data-i18n="nav.tutorials">Tutorials</a></li>
              <li><a href="/tools.html" data-i18n="nav.tools">AI Tools</a></li>
              <li><a href="/news.html" data-i18n="nav.news">News</a></li>
            </ul>
          </div>
          <div class="footer-col">
            <h4 data-i18n="footer.legal">Legal</h4>
            <ul>
              <li><a href="/privacy.html">Privacy Policy</a></li>
              <li><a href="/terms.html">Terms of Service</a></li>
              <li><a href="/license.html">License (BSL 1.1)</a></li>
            </ul>
          </div>
        </div>
      </div>
      <div class="footer-bottom">
        <span>&copy; 2025 hooosberg. <span data-i18n="footer.copy">Licensed under BSL 1.1 — free for personal use.</span></span>
        <span><a href="mailto:zikedece@proton.me">zikedece@proton.me</a></span>
      </div>
    `;
  } else {
    footer.innerHTML = `
      <div class="footer-bottom">
        <span>&copy; 2025 hooosberg &middot; <a href="/terms.html">Terms</a> &middot; <a href="/privacy.html">Privacy</a> &middot; <a href="/license.html">License</a></span>
        <span><a href="mailto:zikedece@proton.me">zikedece@proton.me</a></span>
      </div>
    `;
  }

  document.body.append(footer);
  // Apply i18n to footer elements after they're in the DOM
  applyAll();
}

import { t, applyAll } from '/components/i18n.js';

const CHROME_STORE_URL = '#'; // TODO: replace with real Chrome Web Store URL

export function renderFooter(style = 'full') {
  const footer = document.createElement('footer');
  footer.className = 'footer';

  if (style === 'full') {
    footer.innerHTML = `
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
              <li><a href="/#muscles" data-i18n="store.title">Muscle Store</a></li>
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
          <div class="footer-col">
            <h4 data-i18n="footer.products">Our Products</h4>
            <ul>
              <li><a href="https://hooosberg.github.io/WitNote/" target="_blank">WitNote</a></li>
              <li><a href="https://hooosberg.github.io/DOMPrompter/" target="_blank">DOMPrompter</a></li>
              <li><a href="https://hooosberg.github.io/GlotShot/" target="_blank">GlotShot</a></li>
              <li><a href="https://hooosberg.github.io/TrekReel/" target="_blank">TrekReel</a></li>
              <li><a href="https://uixskills.com" target="_blank">UIXskills</a></li>
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

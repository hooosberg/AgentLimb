/**
 * AgentLimb SEO Module
 * - Injects hreflang tags for 12 languages
 * - Injects Organization + WebSite structured data
 * - Injects breadcrumb structured data
 * - Sets html lang attribute from stored preference
 */

const SITE = 'https://agentlimb.com';
const LANGS = ['en','zh','ja','ko','es','fr','de','pt','ru','ar','it','hi'];

export function initSEO(options = {}) {
  const { breadcrumbs } = options;
  const head = document.head;
  const path = location.pathname;

  // ── 1. hreflang tags (tells Google about language versions) ──
  LANGS.forEach(lang => {
    const link = document.createElement('link');
    link.rel = 'alternate';
    link.hreflang = lang === 'zh' ? 'zh-CN' : lang;
    link.href = `${SITE}${path}`;
    head.appendChild(link);
  });
  // x-default
  const xdef = document.createElement('link');
  xdef.rel = 'alternate';
  xdef.hreflang = 'x-default';
  xdef.href = `${SITE}${path}`;
  head.appendChild(xdef);

  // ── 2. Organization + WebSite structured data (site-wide) ──
  injectLD({
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": "AgentLimb",
    "url": SITE,
    "logo": `${SITE}/icons/icon.svg`,
    "contactPoint": {
      "@type": "ContactPoint",
      "email": "zikedece@proton.me",
      "contactType": "customer support"
    },
    "sameAs": [
      "https://github.com/hooosberg/AgentLimb",
      "https://github.com/hooosberg"
    ]
  });

  injectLD({
    "@context": "https://schema.org",
    "@type": "WebSite",
    "name": "AgentLimb",
    "url": SITE,
    "description": "Give your AI a browser arm. Chrome extension for AI browser automation with muscle memory.",
    "inLanguage": LANGS.map(l => l === 'zh' ? 'zh-CN' : l),
    "potentialAction": {
      "@type": "SearchAction",
      "target": `${SITE}/tools.html?q={search_term_string}`,
      "query-input": "required name=search_term_string"
    }
  });

  // ── 3. Breadcrumb structured data ──
  if (breadcrumbs && breadcrumbs.length) {
    injectLD({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "itemListElement": breadcrumbs.map((bc, i) => ({
        "@type": "ListItem",
        "position": i + 1,
        "name": bc.name,
        "item": bc.url ? `${SITE}${bc.url}` : undefined
      }))
    });
  }
}

function injectLD(data) {
  const script = document.createElement('script');
  script.type = 'application/ld+json';
  script.textContent = JSON.stringify(data);
  document.head.appendChild(script);
}

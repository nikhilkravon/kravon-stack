import { apiGet } from '../shared/api.js';
import { applyTheme } from '../shared/theme.js';
import { formatPrice, foodTypeDot, getTodayHours } from '../shared/utils.js';

const SLUG = 'spice-of-india';
const hero = document.getElementById('hero');
const announcementBar = document.getElementById('announcement-bar');
const stickyNav = document.getElementById('sticky-nav');
const infoStrip = document.getElementById('info-strip');
const menuContainer = document.getElementById('menu');
const footer = document.getElementById('footer');
const loadingScreen = document.getElementById('loading-screen');

function cleansedFontName(name) {
  return String(name || '').trim().replace(/\s+/g, '+');
}

function applyFonts(theme) {
  const heading = theme.font_heading || 'Inter';
  const body = theme.font_body || 'Inter';

  const headingFamily = cleansedFontName(heading);
  const bodyFamily = cleansedFontName(body);

  const url = new URL('https://fonts.googleapis.com/css2');
  url.searchParams.set('family', `${headingFamily}:wght@400;600;700&family=${bodyFamily}:wght@400;500;600`);
  url.searchParams.set('display', 'swap');

  if (!document.querySelector(`link[href^="${url.origin}${url.pathname}"]`)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url.toString();
    document.head.appendChild(link);
  }
}

function applyButtonRadius(theme) {
  const root = document.documentElement;
  const style = theme.button_style;
  let radius;
  if (style === 'pill') radius = '999px';
  else if (style === 'sharp') radius = '0px';
  else radius = '6px';
  root.style.setProperty('--radius-btn', radius);
}

function applyCardRadius(theme) {
  const root = document.documentElement;
  const style = theme.card_style;
  let radius;
  if (style === 'flat') radius = '0px';
  else radius = '12px';
  root.style.setProperty('--radius-card', radius);
}

function applyMeta(seo = {}, assets = {}) {
  document.title = seo.meta_title || document.title || 'Kravon Restaurant';

  const setMeta = (name, content) => {
    if (!content) return;
    let tag = document.querySelector(`meta[name="${name}"]`) || document.querySelector(`meta[property="${name}"]`);
    if (!tag) {
      tag = document.createElement('meta');
      if (name.startsWith('og:')) tag.setAttribute('property', name);
      else tag.setAttribute('name', name);
      document.head.appendChild(tag);
    }
    tag.content = content;
  };

  setMeta('description', seo.meta_description);
  setMeta('og:title', seo.og_title || seo.meta_title);
  setMeta('og:description', seo.og_description || seo.meta_description);
  setMeta('og:image', assets.og_image?.url || assets.banner?.url || '');
}

function renderStars(rating) {
  const filled = Math.round(rating);
  const stars = [];
  for (let i = 1; i <= 5; i += 1) {
    stars.push(`<span class="star">${i <= filled ? '★' : '☆'}</span>`);
  }
  return stars.join('');
}

function parseTime(value) {
  if (!value || typeof value !== 'string') return null;
  const [h, m] = value.split(':').map((v) => parseInt(v, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function isOpenNow(today) {
  if (!today || today.is_closed) return false;
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const opens = parseTime(today.opens_at);
  const closes = parseTime(today.closes_at);
  if (opens === null || closes === null) return false;
  if (closes > opens) {
    return nowMinutes >= opens && nowMinutes <= closes;
  }
  // overnight close (e.g., 22:00 - 02:00)
  return nowMinutes >= opens || nowMinutes <= closes;
}

function renderHero(data) {
  hero.style.backgroundImage = `url('${data.assets?.banner?.url || ''}')`;
  hero.style.minHeight = '70vh';
  hero.style.height = 'auto';

  const today = getTodayHours(data.operating_hours || []);
  const open = isOpenNow(today);

  const restaurantName = data.restaurant?.name || '';
  const logoUrl = data.assets?.logo?.url || '';
  const logoAlt = data.assets?.logo?.alt_text || restaurantName;
  const avgRating = Number(data.reviews?.avg_rating || 0).toFixed(1);
  const totalReviews = Number(data.reviews?.total_reviews || 0);

  hero.innerHTML = `
    <div class="hero-content">
      <img class="logo" src="${logoUrl}" alt="${logoAlt}" />
      <h1 class="restaurant-name">${restaurantName}</h1>
      <div class="rating-wrap">
        ${renderStars(avgRating)}
        <span><strong>${avgRating}</strong> (${totalReviews} reviews)</span>
      </div>
      <div class="open-badge ${open ? 'open' : 'closed'}">${open ? 'Open Now' : 'Closed'}</div>
      <div class="scroll-indicator">↓</div>
    </div>
  `;
}

function renderAnnouncementBar(announcements = []) {
  if (!Array.isArray(announcements) || announcements.length === 0) {
    announcementBar.hidden = true;
    announcementBar.classList.remove('visible');
    return;
  }

  const announcement = announcements[0];
  const cta = announcement.cta_url ? `<a class="cta" href="${announcement.cta_url}" target="_blank" rel="noopener noreferrer">${announcement.cta_label || 'Learn more'}</a>` : '';

  announcementBar.innerHTML = `
    <div>
      <strong>${announcement.title || ''}</strong> ${announcement.body || ''}
    </div>
    ${cta}
  `;

  announcementBar.hidden = false;
  announcementBar.classList.add('visible');
}

function renderStickyNav(restaurant, menu, assets) {
  const logoUrl = restaurant?.settings?.logo_url || assets?.logo?.url || '';
  const restaurantName = restaurant?.name || '';
  const categoryButtons = (Array.isArray(menu) ? menu : []).map((section) => {
    const targetId = `cat-${section.category?.id}`;
    return `<button class="tab" data-target="${targetId}">${section.category?.name || ''}</button>`;
  }).join('');

  stickyNav.innerHTML = `
    <div class="brand">
      ${logoUrl ? `<img src="${logoUrl}" alt="${restaurantName}" />` : ''}
      <span>${restaurantName}</span>
    </div>
    <div class="category-tabs">${categoryButtons}</div>
  `;

  const tabs = stickyNav.querySelectorAll('.tab');
  tabs.forEach((tab, idx) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const target = document.getElementById(tab.dataset.target);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    if (idx === 0) tab.classList.add('active');
  });
}

function renderInfoStrip(operatingHours, reviews, contactLinks) {
  const today = getTodayHours(operatingHours || []);
  const open = isOpenNow(today);
  const times = today?.is_closed ? 'Closed today' : `${today?.opens_at} – ${today?.closes_at}`;

  const hoursMarkup = `
    <div class="section">
      <span class="${open ? 'badge-open' : 'badge-closed'}"></span>
      <span>${open ? 'Open today' : 'Closed today'} ${today?.is_closed ? '' : times}</span>
    </div>
  `;

  const ratingMarkup = `
    <div class="section">
      <span>⭐</span>
      <span>${Number(reviews?.avg_rating || 0).toFixed(1)} (${Number(reviews?.total_reviews || 0)} reviews)</span>
    </div>
  `;

  const contacts = (Array.isArray(contactLinks) ? contactLinks : []).map((link) => {
    const iconMap = { instagram: '📸', zomato: '🍽️', google_maps: '📍', whatsapp: '💬' };
    const icon = iconMap[link.platform] || '🔗';
    return `<a class="contact-link" href="${link.url}" target="_blank" rel="noopener noreferrer">${icon} ${link.display_label || link.platform}</a>`;
  }).join('');

  infoStrip.innerHTML = `
    <div class="section">${hoursMarkup}</div>
    <div class="section">${ratingMarkup}</div>
    <div class="section">${contacts}</div>
  `;
}

function renderMenu(menu) {
  menuContainer.innerHTML = '';
  if (!Array.isArray(menu) || menu.length === 0) {
    menuContainer.innerHTML = '<p>No menu items available.</p>';
    return;
  }

  menu.forEach((group) => {
    const section = document.createElement('section');
    section.className = 'menu-category';
    section.id = `cat-${group.category?.id}`;

    const title = document.createElement('h2');
    title.textContent = group.category?.name || '';
    section.appendChild(title);

    if (group.category?.description) {
      const desc = document.createElement('p');
      desc.className = 'description';
      desc.textContent = group.category.description;
      section.appendChild(desc);
    }

    const grid = document.createElement('div');
    grid.className = 'item-grid';

    (Array.isArray(group.items) ? group.items : []).forEach((item) => {
      const card = document.createElement('article');
      card.className = 'menu-item-card';
      if (!item.is_available) card.classList.add('unavailable');

      const foodType = item.food_type || 'unknown';
      const variantPrices = Array.isArray(item.variants) && item.variants.length > 0
        ? item.variants.map((v) => Number(v.price || 0))
        : [];
      const priceText = item.has_variants && variantPrices.length
        ? `₹${Math.min(...variantPrices)} – ₹${Math.max(...variantPrices)}`
        : formatPrice(item.price || 0);

      const left = document.createElement('div');
      left.className = 'content';

      left.innerHTML = `
        <div class="meta">
          <span class="food-dot ${foodType}"></span>
          <span class="name">${item.name || ''}</span>
        </div>
        <p class="description">${item.description || ''}</p>
        <div class="tags">${(Array.isArray(item.tags) ? item.tags : []).map((tag) => `<span class="tag">${tag}</span>`).join('')}</div>
        <div class="price-row">${item.is_available ? priceText : 'Unavailable'}</div>
      `;

      card.appendChild(left);

      if (item.image_url) {
        const img = document.createElement('img');
        img.src = item.image_url;
        img.alt = item.name || 'Menu item';
        card.appendChild(img);
      }

      grid.appendChild(card);
    });

    section.appendChild(grid);
    menuContainer.appendChild(section);
  });
}

function initStickyNav() {
  const heroHeight = hero.offsetHeight || window.innerHeight * 0.6;
  window.addEventListener('scroll', () => {
    if (window.scrollY > heroHeight) {
      stickyNav.classList.add('scrolled');
    } else {
      stickyNav.classList.remove('scrolled');
    }
  });
}

function initMenuTabs() {
  const sections = Array.from(document.querySelectorAll('.menu-category'));
  const options = { rootMargin: '-60px 0px -60px 0px', threshold: 0.1 };
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const tab = stickyNav.querySelector(`[data-target="${entry.target.id}"]`);
      if (entry.isIntersecting) {
        stickyNav.querySelectorAll('.tab').forEach((btn) => btn.classList.remove('active'));
        if (tab) tab.classList.add('active');
      }
    });
  }, options);

  sections.forEach((section) => observer.observe(section));
}

function hideLoadingScreen() {
  if (!loadingScreen) return;
  loadingScreen.classList.add('hidden');
  setTimeout(() => {
    loadingScreen.style.display = 'none';
  }, 300);
}

function showError(message, details = '') {
  const detailBlock = details ? `<pre style="white-space: pre-wrap; color: #900;">${details}</pre>` : '';
  if (menuContainer) {
    menuContainer.innerHTML = `<p>${message}</p>${detailBlock}`;
  }
  hideLoadingScreen();
}

window.addEventListener('error', (event) => {
  showError('An unexpected JavaScript error occurred.', event.message || 'Unknown error');
});

window.addEventListener('unhandledrejection', (event) => {
  showError('Unhandled promise rejection.', event.reason ? JSON.stringify(event.reason) : 'Unknown reason');
});

async function init() {
  try {
    const response = await apiGet(`/presence/${SLUG}`);
    const restaurant = response.restaurant || {};
    const theme = response.theme || {};

    applyTheme(theme, response.seo?.meta_title || restaurant.name);
    applyFonts(theme);
    applyButtonRadius(theme);
    applyCardRadius(theme);
    applyMeta(response.seo || {}, response.assets || {});

    renderHero(response);
    renderAnnouncementBar(response.announcements || []);
    renderStickyNav(restaurant, response.menu || [], response.assets || {});
    renderInfoStrip(response.operating_hours || [], response.reviews || {}, response.contact_links || []);
    renderMenu(response.menu || []);
    renderFooter(restaurant, response.contact_links || []);

    initStickyNav();
    initMenuTabs();

    hideLoadingScreen();
  } catch (error) {
    console.error(error);
    showError('Unable to load restaurant page. Please try again.');
  }
}

function renderFooter(restaurant, contactLinks) {
  const logoUrl = restaurant.logo_url ? restaurant.logo_url : (document.querySelector('#hero img')?.src || '');
  footer.innerHTML = `
    <div class="footer-content">
      <div class="footer-brand">
        ${logoUrl ? `<img src="${logoUrl}" alt="${restaurant.name || ''}" />` : ''}
        <span style="font-family: var(--font-heading);">${restaurant.name || ''}</span>
      </div>
      <div class="footer-links">
        ${(Array.isArray(contactLinks) ? contactLinks : []).map((link) => `<a href="${link.url}" target="_blank" rel="noopener noreferrer">${link.display_label || link.platform}</a>`).join('')}
      </div>
    </div>
    <div class="bottom">Powered by Kravon</div>
  `;
}

document.addEventListener('DOMContentLoaded', init);


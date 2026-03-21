# Kravon Frontend (Vanilla)

Static frontend scaffold for Kravon restaurant SaaS.

## Folder structure

kravon-frontend/
  shared/
    api.js
    auth.js
    theme.js
    utils.js
  presence/
    index.html
    style.css
    app.js
  orders/
    index.html
    style.css
    app.js
  tables/
    index.html
    style.css
    app.js
  catering/
    index.html
    style.css
    app.js
  insights/
    index.html
    style.css
    app.js
  assets/
    icons/ (empty placeholder)
  .gitignore
  README.md

## How to run locally

1. Open `presence/index.html` in your browser (or via a local static server).
2. The app loads data from `http://localhost:3000/api` using `shared/api.js`.
3. Other modules are placeholders and print "Coming soon".

## Behavior

- All pages use mobile-first CSS and CSS variables from `:root`.
- `presence/app.js` calls `apiGet('/presence/spice-of-india')`, applies theme, and renders content.
- `orders`, `tables`, `catering`, `insights` show coming soon text.

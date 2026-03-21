const loading = document.getElementById('loading');
const app = document.getElementById('app');

document.addEventListener('DOMContentLoaded', () => {
  console.log('Module: insights - coming soon');
  if (loading) loading.style.display = 'none';
  if (app) app.innerHTML = '<p>Coming soon</p>';
});

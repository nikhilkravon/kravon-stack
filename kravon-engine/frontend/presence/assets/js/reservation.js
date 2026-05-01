(function () {
  'use strict';

  const form = document.getElementById('reservationForm');
  const statusEl = document.getElementById('reservationStatus');
  const submitBtn = document.getElementById('reservationSubmit');

  const _q = new URLSearchParams(window.location.search);
  const API_BASE = typeof KRAVON_API_URL !== 'undefined'
    ? KRAVON_API_URL
    : (_q.get('api') || 'http://localhost:3000');
  const SLUG = typeof RESTAURANT_SLUG_ENV !== 'undefined'
    ? RESTAURANT_SLUG_ENV
    : _q.get('slug');

  function showStatus(message, success) {
    statusEl.textContent = message;
    statusEl.className = `reserve-status ${success ? 'success' : 'error'}`;
  }

  function buildRequestBody() {
    const name = document.getElementById('customer_name').value;
    const phone = document.getElementById('customer_phone').value;
    const email = document.getElementById('customer_email')?.value;
    const date = document.getElementById('reservation_date').value;
    const time = document.getElementById('reservation_time').value;
    const partySize = document.getElementById('party_size').value;
    const occasion = document.getElementById('occasion').value;
    const dietaryNotes = document.getElementById('dietary_notes').value;

    const iso = new Date(`${date}T${time}:00`).toISOString();

    const payload = {
      customer_name:  name.trim(),
      customer_phone: phone.trim(),
      customer_email: email?.trim() || undefined,
      party_size:     parseInt(partySize, 10) || 1,
      reservation_time: iso,
      occasion:       occasion.trim() || undefined,
      dietary_notes:  dietaryNotes.trim() || undefined,
    };
    return payload;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!SLUG) {
      showStatus('Restaurant slug missing. Add ?slug=... to the URL.', false);
      return;
    }

    submitBtn.disabled = true;
    showStatus('Sending reservation request…', true);

    try {
      const payload = buildRequestBody();
      const res = await fetch(`${API_BASE}/v1/restaurants/${SLUG}/dine-in/reservations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Could not submit reservation.');
      }
      showStatus(`Reservation requested. Confirmation code: ${data.confirmation_code}`, true);
      form.reset();
    } catch (err) {
      showStatus(err.message, false);
    } finally {
      submitBtn.disabled = false;
    }
  });
})();

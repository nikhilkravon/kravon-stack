(function () {
  'use strict';

  const form      = document.getElementById('reservationForm');
  const statusEl  = document.getElementById('reservationStatus');
  const submitBtn = document.getElementById('reservationSubmit');
  const dateInput = document.getElementById('reservation_date');
  const partySzEl = document.getElementById('party_size');

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

  function showClosed(message) {
    form.style.display = 'none';
    const banner = document.createElement('div');
    banner.style.cssText = 'background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:16px;padding:32px;text-align:center;';
    banner.innerHTML = `<div style="font-size:36px;margin-bottom:12px">🌙</div>
      <p style="color:rgba(240,234,224,0.9);font-size:16px;margin:0">${message}</p>`;
    form.parentNode.insertBefore(banner, form);
  }

  // Generate 30-minute time slots between open and close
  function _genSlots(open, close) {
    const slots = [];
    const [oh, om] = open.split(':').map(Number);
    const [ch, cm] = close.split(':').map(Number);
    let cur = oh * 60 + om;
    const end = ch * 60 + cm;
    while (cur < end) {
      const h   = Math.floor(cur / 60);
      const m   = cur % 60;
      const hhmm = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      const ampm = h < 12 ? 'AM' : 'PM';
      const dh   = h === 0 ? 12 : h > 12 ? h - 12 : h;
      slots.push({ value: hhmm, label: `${dh}:${String(m).padStart(2, '0')} ${ampm}` });
      cur += 30;
    }
    return slots;
  }

  function _populateTimes(resCfg) {
    const sel  = document.getElementById('reservation_time');
    if (!sel) return;
    const val  = dateInput.value;
    if (!val) return;

    const date   = new Date(val + 'T00:00:00');
    const dayOfW = date.getDay(); // 0=Sun
    const slots  = resCfg.slots || [];

    sel.innerHTML = '';

    // No slots configured — offer half-hour slots across a default 10am–10pm window
    if (!slots.length) {
      const defaultSlots = _genSlots('10:00', '22:00');
      const placeholder  = document.createElement('option');
      placeholder.value  = '';
      placeholder.textContent = 'Select a time';
      sel.appendChild(placeholder);
      defaultSlots.forEach(ts => {
        const opt = document.createElement('option');
        opt.value = ts.value; opt.textContent = ts.label;
        sel.appendChild(opt);
      });
      return;
    }

    const daySlots = slots.filter(s => s.day === dayOfW);

    if (!daySlots.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No availability on this day';
      sel.appendChild(opt);
      return;
    }

    // Add placeholder
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select a time';
    sel.appendChild(placeholder);

    // Enforce min advance lead time
    const minMs   = (resCfg.minAdvanceHours ?? 2) * 3600_000;
    const nowPlus = Date.now() + minMs;

    daySlots.forEach(slot => {
      const timeSlots = _genSlots(slot.open, slot.close);
      timeSlots.forEach(ts => {
        const slotDate = new Date(`${val}T${ts.value}:00`);
        if (slotDate.getTime() < nowPlus) return;
        const opt = document.createElement('option');
        opt.value       = ts.value;
        opt.textContent = ts.label;
        sel.appendChild(opt);
      });
    });

    if (sel.children.length === 1) {
      sel.children[0].textContent = 'No times available today';
    }
  }

  // Load config and bootstrap the form
  async function bootstrap() {
    if (!SLUG) {
      showStatus('Restaurant slug missing. Add ?slug=... to the URL.', false);
      return;
    }

    let resCfg = { acceptsReservations: true, maxAdvanceDays: 30, minAdvanceHours: 2, maxPartySize: 12, slots: [] };

    try {
      const resp = await fetch(`${API_BASE}/v1/restaurants/${SLUG}/config`);
      if (resp.ok) {
        const data = await resp.json();
        if (data.config?.reservations) resCfg = data.config.reservations;
      }
    } catch (_) { /* fall through with defaults */ }

    if (!resCfg.acceptsReservations) {
      showClosed('We are not currently accepting reservations. Please call us to book a table.');
      return;
    }

    // Set date constraints
    const now       = new Date();
    const minDate   = new Date(now.getTime() + (resCfg.minAdvanceHours ?? 2) * 3600_000);
    const maxDate   = new Date(now.getTime() + (resCfg.maxAdvanceDays  ?? 30) * 86400_000);

    const toDateStr = d => d.toISOString().slice(0, 10);
    dateInput.min = toDateStr(minDate);
    dateInput.max = toDateStr(maxDate);
    dateInput.value = toDateStr(minDate);

    // Set party size max
    if (partySzEl) partySzEl.max = resCfg.maxPartySize ?? 50;

    // Populate times on date change
    dateInput.addEventListener('change', () => _populateTimes(resCfg));
    _populateTimes(resCfg);

    // Form submit
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const timeVal = document.getElementById('reservation_time')?.value;

      if (!timeVal) {
        showStatus('Please select a time.', false);
        return;
      }

      const name     = document.getElementById('customer_name').value.trim();
      const phone    = document.getElementById('customer_phone').value.trim();
      const email    = document.getElementById('customer_email')?.value?.trim();
      const dateVal  = dateInput.value;
      const partySz  = parseInt(partySzEl.value, 10) || 1;
      const occasion = document.getElementById('occasion').value.trim();
      const dietary  = document.getElementById('dietary_notes').value.trim();

      const localIso = new Date(`${dateVal}T${timeVal}:00`).toISOString();

      submitBtn.disabled = true;
      showStatus('Sending reservation request…', true);

      try {
        const res = await fetch(`${API_BASE}/v1/restaurants/${SLUG}/dine-in/reservations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customer_name:    name,
            customer_phone:   phone,
            ...(email    ? { customer_email:  email    } : {}),
            party_size:       partySz,
            reservation_time: localIso,
            ...(occasion ? { occasion }          : {}),
            ...(dietary  ? { dietary_notes: dietary } : {}),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not submit reservation.');
        showStatus(`✓ Reservation requested! Confirmation code: ${data.confirmation_code}`, true);
        form.reset();
        dateInput.value = toDateStr(minDate);
        _populateTimes(resCfg);
      } catch (err) {
        showStatus(err.message, false);
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  bootstrap();
})();

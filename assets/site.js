(() => {
  // Seasonal copy switches by the date in India (e.g. Vijayadasami banner ends on 21 Oct).
  const ist = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  document.querySelectorAll('[data-until]').forEach((el) => { if (ist >= el.dataset.until) el.remove(); });
  document.querySelectorAll('[data-after]').forEach((el) => { if (ist >= el.dataset.after) el.hidden = false; });

  // ---- Admission leads: saved to the "AdmissionLeads" collection on the KIMS India Wix site (same as apply.kimsindia.com).
  // The client ID is public: it only mints anonymous visitor tokens, and the collection lets visitors add or update
  // entries but never read them. Wix "save" replaces the whole record, so every save sends every field.
  const WIX = { api: 'https://www.wixapis.com', clientId: '827f6966-0d99-4fb9-be2b-a1068c2e08b3', collection: 'AdmissionLeads' };
  const LEAD_KEY = 'kims.enquiry.v1';
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode: the form still works */ } },
  };
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16); }));
  const device = matchMedia('(pointer: coarse)').matches ? 'mobile' : 'desktop';
  const validMobile = (p) => /^[6-9]\d{9}$/.test(p || '');
  const digits = (v) => { let d = String(v).replace(/\D/g, ''); if (d.length > 10 && d.startsWith('91')) d = d.slice(2); if (d.length > 10 && d[0] === '0') d = d.slice(1); return d.slice(0, 10); };
  let token = store.get('kims.token.v1');
  async function wixToken() {
    if (token && token.exp > Date.now() + 60000) return token.value;
    const r = await fetch(WIX.api + '/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: WIX.clientId, grantType: 'anonymous' }) });
    if (!r.ok) throw new Error('token ' + r.status);
    const d = await r.json();
    token = { value: d.access_token, exp: Date.now() + (d.expires_in || 3600) * 1000 };
    store.set('kims.token.v1', token);
    return token.value;
  }
  const FIELDS = ['relation', 'studentName', 'gender', 'dateOfBirth', 'classApplying', 'nativeLanguage', 'fatherName', 'fatherOccupation', 'fatherMobile',
    'motherName', 'motherOccupation', 'motherMobile', 'email', 'address', 'pincode', 'referredBy', 'visitDate', 'visitTime'];
  // a record only moves forward: a family who asked for a visit never drops back to "Enquiry started"
  const RANK = ['Call requested', 'Enquiry started', 'Enquiry submitted', 'Visit request started', 'Visit requested'];
  const advance = (cur, next) => (RANK.indexOf(next) > RANK.indexOf(cur) ? next : cur);
  function record(lead) {
    const f = lead.fields || {};
    const plus = (p) => (validMobile(p) ? '+91' + p : (p || ''));
    const data = { _id: lead.id, phone: '+91' + lead.phone, status: lead.status, callTapped: false, source: lead.source || 'website', device };
    FIELDS.forEach((k) => { data[k] = f[k] || ''; });
    data.fatherMobile = plus(f.fatherMobile); data.motherMobile = plus(f.motherMobile);
    data.name = (f.relation === 'Mother' ? f.motherName : f.relation === 'Father' ? f.fatherName : '') || f.fatherName || f.motherName || '';
    return JSON.stringify({ dataCollectionId: WIX.collection, dataItem: { id: lead.id, data } });
  }
  async function saveLead(lead, keepalive) {
    const body = record(lead);
    const send = async (t) => fetch(WIX.api + '/wix-data/v2/items/save', { method: 'POST', keepalive: !!keepalive, headers: { 'Content-Type': 'application/json', Authorization: t }, body });
    let r = await send(await wixToken());
    if (r.status === 401 || r.status === 403) { token = null; r = await send(await wixToken()); }
    if (!r.ok) throw new Error('save ' + r.status);
    return true;
  }

  // ---- Google Analytics events (gtag only loads on www.kimsindia.com). A lead counts once, when we first have the number;
  // the Google Ads conversion is the same "Admission form submitted" goal as apply.kimsindia.com, keyed by the lead id.
  const track = (name, params) => { try { if (window.gtag) window.gtag('event', name, params || {}); } catch (e) { /* never block the form */ } };
  function leadCaptured(lead, formName) {
    if (lead.tracked) return;
    lead.tracked = true;
    track('generate_lead', { form: formName, device });
    track('conversion', { send_to: 'AW-18496684895/iCqdCOWSxJMdEN-G9PNE', value: 1, currency: 'INR', transaction_id: lead.id });
  }
  const where = (a) => { const s = a.closest('section[id], header, footer, .dock, .callback, .eq-done, .eq-side'); return s ? (s.id || s.className.split(' ')[0] || s.tagName.toLowerCase()) : 'page'; };
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]'); if (!a) return;
    const h = a.getAttribute('href'), at = { location: where(a), page: location.pathname };
    if (h.startsWith('tel:')) track('click_to_call', at);
    else if (h.includes('wa.me/')) track('whatsapp_click', at);
    else if (h.includes('maps.app.goo.gl') || h.includes('google.com/maps')) track('get_directions', at);
  });

  // ---- Home page call-back card: save the number at once, then open the admission enquiry form with it filled in.
  // The number goes to the next page through this browser's storage, never in the web address.
  const form = document.getElementById('cbForm');
  if (form) {
    const input = document.getElementById('cbPhone');
    const msg = document.getElementById('cbMsg');
    input.addEventListener('input', () => { input.value = digits(input.value); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const ok = validMobile(input.value);
      msg.hidden = false;
      msg.style.color = ok ? '' : 'var(--red)';
      if (!ok) { msg.textContent = 'Please enter a 10-digit mobile number starting with 6, 7, 8 or 9.'; input.focus(); return; }
      const lead = { id: uuid(), phone: input.value, status: 'Call requested', source: 'website: home call-back', fields: {}, synced: false };
      leadCaptured(lead, 'call-back');
      store.set(LEAD_KEY, lead);
      msg.textContent = 'Thank you! Opening the admission form…';
      form.querySelector('button').disabled = true;
      try { await Promise.race([saveLead(lead).then(() => { lead.synced = true; store.set(LEAD_KEY, lead); }), new Promise((r) => setTimeout(r, 2500))]); } catch (err) { /* the next page saves again */ }
      location.href = '/admission-enquiry/';
    });
  }

  // ---- Admission enquiry and Book a visit pages (one shared form), asked one question at a time.
  // Only the number is required; every answer is saved as it is given, onto the same record the home call-back started.
  const eq = document.getElementById('eq-form');
  if (eq) {
    const visit = eq.dataset.mode === 'visit';
    const STARTED = visit ? 'Visit request started' : 'Enquiry started';
    const DONE = visit ? 'Visit requested' : 'Enquiry submitted';
    let lead = store.get(LEAD_KEY);
    if (!lead || !lead.id) {
      lead = { id: uuid(), phone: '', status: STARTED, source: visit ? 'website: book a visit' : 'website: enquiry form', fields: {}, synced: false };
    }
    lead.fields = lead.fields || {};
    const persist = () => store.set(LEAD_KEY, lead);
    const $ = (id) => document.getElementById(id);
    const phone = $('eq-phone'), qPhone = $('q-phone'), saved = $('eq-saved');
    if (visit) {   // visits: from tomorrow, up to two months ahead (dates in India)
      const day = (n) => new Date(Date.now() + 5.5 * 3600e3 + n * 864e5).toISOString().slice(0, 10);
      const d = eq.elements.visitDate; d.min = day(1); d.max = day(60);
    }
    const knewPhone = validMobile(lead.phone);
    if (knewPhone) {
      phone.value = lead.phone;
      $('eq-have').hidden = false; $('eq-lede').hidden = true;
    }
    FIELDS.forEach((k) => {   // answers given earlier on this phone
      const v = lead.fields[k]; if (!v) return;
      const radios = eq.querySelectorAll(`input[type=radio][name="${k}"]`);
      if (radios.length) radios.forEach((r) => { r.checked = r.value === v; });
      else if (eq.elements[k]) eq.elements[k].value = v;
    });

    // saving
    let timer = null, touched = !lead.synced && knewPhone, current = null, again = false;
    async function save(keepalive) {
      if (!touched || !validMobile(lead.phone)) return;
      if (!lead.tracked) { leadCaptured(lead, visit ? 'visit' : 'enquiry'); persist(); }
      if (current && !keepalive) { again = true; return current; }
      current = (async () => {
        try { await saveLead(lead, keepalive); lead.synced = true; saved.textContent = '✓ Saved'; }
        catch (err) { lead.synced = false; saved.textContent = 'Not saved yet. Check your connection; we will try again.'; }
        persist();
      })();
      await current; current = null;
      if (again) { again = false; await save(false); }
    }
    const saveSoon = (ms) => { clearTimeout(timer); timer = setTimeout(() => save(false), ms); };
    addEventListener('pagehide', () => save(true));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(true); });
    if (touched) saveSoon(300);   // the call-back save did not reach Wix: try again now

    // the child's name in later questions
    const childName = () => (lead.fields.studentName || '').split(/\s+/)[0];
    const personalise = () => { const n = childName(); eq.querySelectorAll('[data-child]').forEach((s) => { s.textContent = n || 'your child'; }); };
    personalise();

    eq.addEventListener('input', (e) => {
      const el = e.target;
      if (el.type === 'tel' || el.name === 'pincode') el.value = el.name === 'pincode' ? el.value.replace(/\D/g, '').slice(0, 6) : digits(el.value);
      if (el === phone) { lead.phone = el.value; qPhone.classList.remove('bad'); }
      else if (FIELDS.includes(el.name)) {
        lead.fields[el.name] = el.type === 'radio' ? (el.checked ? el.value : lead.fields[el.name]) : el.value.trim();
        if (el.name === 'relation' && validMobile(lead.phone)) {   // the parent's own number fills in their mobile
          const key = el.value === 'Father' ? 'fatherMobile' : el.value === 'Mother' ? 'motherMobile' : '';
          if (key && !lead.fields[key]) { lead.fields[key] = lead.phone; eq.elements[key].value = lead.phone; }
        }
        if (el.name === 'studentName') personalise();
      }
      el.closest('.eq-f')?.classList.remove('bad');
      lead.status = advance(lead.status, STARTED);
      touched = true; persist(); saved.textContent = '';
      saveSoon(el.type === 'radio' ? 0 : 800);
    });

    // one question at a time
    const steps = [...eq.querySelectorAll('.step')];
    const next = $('eq-next'), back = $('eq-back'), skip = $('eq-skip'), bar = $('eq-bar'), count = $('eq-count');
    eq.classList.add('is-stepper');
    let at = 0;
    function bad(id, cond) { const box = $(id); if (box) box.classList.toggle('bad', cond); return cond; }
    function stepOk(step) {   // only formats are checked; empty answers are fine except the number
      const v = (n) => (eq.elements[n] ? eq.elements[n].value.trim() : '');
      switch (step.dataset.step) {
        case 'phone': return !bad('q-phone', !validMobile(phone.value));
        case 'father': return !bad('q-fmob', !!v('fatherMobile') && !validMobile(v('fatherMobile')));
        case 'mother': return !bad('q-mmob', !!v('motherMobile') && !validMobile(v('motherMobile')));
        case 'address': return !bad('q-pin', !!v('pincode') && v('pincode').length !== 6);
        case 'email': return !bad('q-email', !!v('email') && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v('email')));
        default: return true;
      }
    }
    function show(i, focus = true) {
      at = Math.max(0, Math.min(steps.length - 1, i));
      steps.forEach((s, k) => { s.classList.toggle('active', k === at); s.setAttribute('aria-hidden', k === at ? 'false' : 'true'); });
      const last = at === steps.length - 1;
      bar.style.width = Math.round((at / (steps.length - 1)) * 100) + '%';
      count.textContent = last ? 'Last step' : `Question ${at + 1} of ${steps.length - 1}`;
      back.hidden = at === 0;
      skip.hidden = last || steps[at].hasAttribute('data-required');
      next.hidden = last;
      if (focus) {
        const field = steps[at].querySelector('input:not([type=radio]), textarea');
        const first = field || steps[at].querySelector('input[type=radio]:checked, input[type=radio]');
        if (first && (field || matchMedia('(pointer: fine)').matches)) first.focus({ preventScroll: true });
        eq.scrollIntoView({ block: 'nearest' });
      }
    }
    const go = (dir) => {
      if (dir > 0 && !stepOk(steps[at])) { steps[at].querySelector('.bad input')?.focus(); return; }
      if (dir > 0) save(false);
      let i = at + dir;
      if (dir > 0 && steps[i] && steps[i].dataset.step === 'phone' && knewPhone && validMobile(phone.value)) i += 1;   // we already have it
      show(i);
    };
    next.addEventListener('click', () => go(1));
    back.addEventListener('click', () => go(-1));
    skip.addEventListener('click', () => show(at + 1));
    eq.addEventListener('change', (e) => { if (e.target.type === 'radio') setTimeout(() => go(1), 280); });   // tapping a choice moves on
    eq.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'radio') {
        e.preventDefault();
        const inputs = [...steps[at].querySelectorAll('input:not([type=radio])')];
        const i = inputs.indexOf(e.target);
        if (i > -1 && i < inputs.length - 1) inputs[i + 1].focus(); else go(1);
      }
    });
    eq.querySelectorAll('[data-fill]').forEach((b) => b.addEventListener('click', () => {   // quick answers
      const input = $(b.dataset.fill); input.value = b.textContent; input.dispatchEvent(new Event('input', { bubbles: true })); go(1);
    }));
    // start at the first unanswered question; a number we already have is not asked again
    let start = 0;
    if (knewPhone) {
      start = steps.findIndex((s) => s.dataset.step !== 'phone' && !(s.querySelector('input[type=radio]:checked') || [...s.querySelectorAll('input:not([type=radio]), textarea')].some((x) => x.value)));
      if (start < 0) start = steps.length - 1;
    }
    show(start, false);

    eq.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!validMobile(lead.phone)) { show(steps.findIndex((s) => s.dataset.step === 'phone')); qPhone.classList.add('bad'); return; }
      lead.status = advance(lead.status, DONE); touched = true; persist();
      clearTimeout(timer);
      if (current) await current;   // let a save already on its way finish, then send the final state
      await save(false);
      const f = lead.fields;
      track(visit ? 'visit_requested' : 'enquiry_submitted', { class_applying: f.classApplying || '' });
      const first = ((f.relation === 'Mother' ? f.motherName : f.fatherName) || f.fatherName || f.motherName || '').split(/\s+/)[0];
      $('eq-done-title').textContent = first ? `Thank you, ${first}!` : 'Thank you!';
      eq.hidden = true;
      const done = $('eq-done');
      done.hidden = false; done.scrollIntoView({ block: 'start' }); done.focus({ preventScroll: true });
    });
    $('eq-again').addEventListener('click', () => {
      const f = lead.fields;
      const keep = { relation: f.relation, fatherName: f.fatherName, fatherOccupation: f.fatherOccupation, fatherMobile: f.fatherMobile,
        motherName: f.motherName, motherOccupation: f.motherOccupation, motherMobile: f.motherMobile, email: f.email, address: f.address,
        pincode: f.pincode, referredBy: f.referredBy, nativeLanguage: f.nativeLanguage, visitDate: f.visitDate, visitTime: f.visitTime };
      lead = { id: uuid(), phone: lead.phone, status: STARTED, source: visit ? 'website: book a visit' : 'website: enquiry form', fields: keep, synced: false, tracked: true };   // same family: not a new lead
      persist();
      eq.elements.studentName.value = ''; eq.elements.dateOfBirth.value = '';
      eq.querySelectorAll('input[name="gender"], input[name="classApplying"]').forEach((r) => { r.checked = false; });
      personalise();
      $('eq-done').hidden = true; eq.hidden = false; saved.textContent = '';
      show(steps.findIndex((s) => s.dataset.step === 'studentName'));
    });
  }

  // Tour video: load YouTube only when the parent taps play (keeps the page fast, no tracking until then).
  document.querySelectorAll('[data-yt]').forEach((btn) => btn.addEventListener('click', () => {
    const f = document.createElement('iframe');
    f.src = 'https://www.youtube-nocookie.com/embed/' + btn.dataset.yt + '?autoplay=1&rel=0';
    f.title = 'KIMS Selaiyur walk-through video';
    f.allow = 'autoplay; encrypted-media; picture-in-picture'; f.allowFullscreen = true;
    btn.replaceChildren(f);
  }, { once: true }));

  // Light / dark switch. A saved choice wins; otherwise the device setting decides.
  const root = document.documentElement;
  const current = () => root.dataset.theme || 'light';
  const toggle = document.querySelector('.theme');
  const label = () => { if (toggle) toggle.setAttribute('aria-label', current() === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'); };
  if (toggle) {
    label();
    toggle.addEventListener('click', () => {
      const next = current() === 'dark' ? 'light' : 'dark';
      root.dataset.theme = next;
      try { localStorage.setItem('kims-theme', next); } catch (e) { /* private mode: still switches for this page */ }
      label();
    });
  }

  // Event photos open large in a simple viewer; without JS the link just opens the image.
  const links = document.querySelectorAll('[data-lightbox]');
  if (links.length && window.HTMLDialogElement) {
    const dlg = document.createElement('dialog');
    dlg.className = 'lightbox';
    dlg.innerHTML = '<button type="button" aria-label="Close">×</button><img alt="">';
    document.body.append(dlg);
    const big = dlg.querySelector('img');
    dlg.querySelector('button').addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    links.forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      big.src = a.href; big.alt = a.querySelector('img').alt;
      dlg.showModal();
    }));
  }
})();

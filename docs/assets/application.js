/* ICS MA & PhD: the online application form (on /apply/).
 *
 * Flow: the applicant completes the form → pays the application fee with
 * PayPal → once PayPal confirms the payment, the application (with any
 * uploaded documents) is posted to the Google Apps Script in _scripts/, which
 * checks every answer again before saving anything. Setup: _scripts/SETUP.md.
 *
 * The same script runs the education programs' form (education repo,
 * js/application.js); only CONFIG differs.
 */
(function () {
  'use strict';

  /* ── Settings ────────────────────────────────────────────────────────────── */

  var CONFIG = {
    // The Apps Script web app URL (ends in /exec). Until it is set, the form
    // shows a "write to the Registrar" notice instead of the payment buttons.
    SCRIPT_URL: '',
    // ICS's live PayPal client ID (the same PayPal app as ART in Orvieto and F2BF).
    PAYPAL_CLIENT_ID: 'AdZ0cWK3Bl7wjgmrmgk_On-ac13XCdpZxx8te_4IPlRDVoYx3ZNoGG8vK7mb8VXdKH2L-TM1M3sMj6oI',
    SERVICE: 'ICS MA/PhD',           // names the application in PayPal and emails
    REF_PREFIX: 'PHIL',
    FEE: 90,                         // CAD, by the deadline
    LATE_FEE: 120,                   // CAD, after the deadline
    // Each program: academic referees required, and its start terms with the
    // application deadline for each, as [month, day, years before the start].
    PROGRAMS: {
      ma:  { name: 'Master of Arts (MA)', referees: 2, terms: { fall: [2, 1, 0] } },
      phd: { name: 'Doctoral Studies (PhD)', referees: 3, terms: { fall: [2, 1, 0] } }
    },
    TERMS_SHOWN: 2,                  // how many upcoming start terms to offer
    MAX_FILE_BYTES: 10 * 1024 * 1024,
    MAX_EDU_ROWS: 6,
    DRAFT_KEY: 'ics-maphd-application-draft'
  };
  var TERMS = { winter: { label: 'Winter', month: 1, when: 'January' }, summer: { label: 'Summer', month: 5, when: 'May' }, fall: { label: 'Fall', month: 9, when: 'September' } };
  var TERM_ORDER = ['winter', 'summer', 'fall'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var FILE_TYPES = {
    pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    odt: 'application/vnd.oasis.opendocument.text', rtf: 'application/rtf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png'
  };
  var REGISTRAR = 'academic-registrar@icscanada.edu';

  var form = document.getElementById('application');
  if (!form) return;
  var stateBox = document.getElementById('af-state');
  var errorBox = document.getElementById('af-error');
  var paySlot = document.getElementById('af-paypal');
  var eduRows = document.getElementById('af-edu-rows');
  var eduTemplate = document.getElementById('af-edu-template');
  var eduAdd = document.getElementById('af-edu-add');
  var startSelect = form.elements.start;

  var docs = {};           // uploaded File per document slot, keyed by data-doc
  var attempted = false;   // show inline errors live once a send was attempted
  var draft = loadDraft();
  var ref = draft.ref || newRef();
  var paidOrderId = draft.paidOrderId || null;  // payment taken, application not yet delivered
  var paidFee = draft.paidFee || null;

  /* ── Small helpers ───────────────────────────────────────────────────────── */

  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function val(name) {
    var el = form.elements[name];
    if (!el) return '';
    if (el.type === 'checkbox') return el.checked ? 'yes' : '';
    if (el instanceof RadioNodeList || (el.length && el[0] && el[0].type === 'radio')) return el.value || '';
    return (el.value || '').trim();
  }
  function newRef() {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', out = '';
    var bytes = new Uint8Array(6);
    (window.crypto || window.msCrypto).getRandomValues(bytes);
    for (var i = 0; i < 6; i++) out += chars[bytes[i] % chars.length];
    return CONFIG.REF_PREFIX + '-' + new Date().getFullYear() + '-' + out;
  }
  function sizeLabel(bytes) { return bytes < 1048576 ? Math.max(1, Math.round(bytes / 1024)) + ' KB' : (bytes / 1048576).toFixed(1) + ' MB'; }
  function money(n) { return 'CAD $' + Number(n).toFixed(2); }
  function longDate(d) { return MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear(); }
  function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
  function icon(path) { return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + path + '"/></svg>'; }
  function program() { return CONFIG.PROGRAMS[val('program')] || null; }
  var SCROLL = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  /* Shown by the form's own conditions (the form itself is hidden while sending). */
  function visible(el) { var h = el.closest('[hidden]'); return !h || h === form; }

  /* ── Draft (this device only; files are never stored) ────────────────────── */

  function loadDraft() {
    try { return JSON.parse(localStorage.getItem(CONFIG.DRAFT_KEY)) || {}; } catch (e) { return {}; }
  }
  var saveTimer;
  function saveDraft() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      var data = { ref: ref, paidOrderId: paidOrderId, paidFee: paidFee, fields: {}, education: readEducation(true) };
      $all('input[name], textarea[name], select[name]', form).forEach(function (el) {
        if (el.type === 'radio') { if (el.checked) data.fields[el.name] = el.value; }
        else if (el.type === 'checkbox') data.fields[el.name] = el.checked;
        else data.fields[el.name] = el.value;
      });
      try { localStorage.setItem(CONFIG.DRAFT_KEY, JSON.stringify(data)); } catch (e) { /* storage unavailable */ }
    }, 300);
  }
  function clearDraft() { clearTimeout(saveTimer); try { localStorage.removeItem(CONFIG.DRAFT_KEY); } catch (e) { /* ignore */ } }
  function restoreDraft(only) {
    var f = draft.fields || {};
    Object.keys(f).forEach(function (name) {
      if (only && only.indexOf(name) === -1) return;
      $all('[name="' + name + '"]', form).forEach(function (el) {
        if (el.type === 'radio') el.checked = el.value === f[name];
        else if (el.type === 'checkbox') el.checked = !!f[name];
        else el.value = f[name];
      });
    });
  }

  /* ── Education rows ──────────────────────────────────────────────────────── */

  var eduCount = 0;
  function addEduRow(data) {
    var row = eduTemplate.content.firstElementChild.cloneNode(true);
    var n = eduCount++;
    $all('.af-field', row).forEach(function (field) {
      var input = field.querySelector('input');
      var id = 'af-edu-' + n + '-' + input.getAttribute('data-edu');
      input.id = id;
      field.querySelector('label').setAttribute('for', id);
      if (data) input.value = data[input.getAttribute('data-edu')] || '';
    });
    row.querySelector('.af-row-remove').addEventListener('click', function () {
      row.remove();
      syncEdu();
      saveDraft();
      revalidate();
      var first = eduRows.querySelector('input');
      if (first) first.focus();
    });
    eduRows.appendChild(row);
    syncEdu();
    return row;
  }
  function syncEdu() {
    var rows = $all('.af-edu-row', eduRows);
    rows.forEach(function (r) { r.querySelector('.af-row-remove').hidden = rows.length === 1; });
    eduAdd.hidden = rows.length >= CONFIG.MAX_EDU_ROWS;
  }
  function readEducation(all) {
    return $all('.af-edu-row', eduRows).map(function (r) {
      var o = {};
      $all('input', r).forEach(function (i) { o[i.getAttribute('data-edu')] = i.value.trim(); });
      return o;
    }).filter(function (o) { return all || o.institution || o.degree || o.year; });
  }
  eduAdd.addEventListener('click', function () {
    addEduRow().querySelector('input').focus();
  });

  /* ── Start terms and the fee ─────────────────────────────────────────────── */

  /** The next few start terms the chosen program offers, each with its deadline. */
  function upcomingTerms(p) {
    var now = new Date(), out = [];
    for (var y = now.getFullYear(); y <= now.getFullYear() + 3 && out.length < CONFIG.TERMS_SHOWN; y++) {
      TERM_ORDER.forEach(function (key) {
        var dl = p.terms[key];
        if (!dl || out.length >= CONFIG.TERMS_SHOWN || new Date(y, TERMS[key].month - 1, 1) <= now) return;
        var deadline = new Date(y - dl[2], dl[0] - 1, dl[1], 23, 59, 59);
        out.push({ id: key + '-' + y, label: TERMS[key].label + ' ' + y, when: TERMS[key].when, deadline: deadline, late: now > deadline });
      });
    }
    return out;
  }
  var terms = [];
  function syncTerms() {
    var p = program(), keep = startSelect.value;
    terms = p ? upcomingTerms(p) : [];
    startSelect.innerHTML = '<option value="">' + (p ? 'Choose a start term' : 'Choose your program first') + '</option>' +
      terms.map(function (t) { return '<option value="' + t.id + '">' + esc(t.label + ' (' + t.when + ')') + '</option>'; }).join('');
    startSelect.disabled = !p;
    startSelect.value = terms.some(function (t) { return t.id === keep; }) ? keep : '';
    syncFee();
  }
  function chosenTerm() {
    for (var i = 0; i < terms.length; i++) if (terms[i].id === startSelect.value) return terms[i];
    return null;
  }
  function fee() {
    var t = chosenTerm();
    return t && t.late ? CONFIG.LATE_FEE : CONFIG.FEE;
  }
  function syncFee() {
    var t = chosenTerm();
    var note = document.getElementById('af-start-note');
    note.innerHTML = !t ? '' : t.late
      ? 'The deadline for ' + esc(t.label) + ' was ' + longDate(t.deadline) + '. Late applications are considered at the admissions committee’s discretion, and the fee is ' + money(CONFIG.LATE_FEE) + '.'
      : 'Apply by ' + longDate(t.deadline) + ' for ' + esc(t.label) + '.';
    note.hidden = !t;
    var shown = paidFee || fee();
    document.getElementById('af-fee-label').innerHTML = (shown === CONFIG.LATE_FEE ? 'Late application fee' : 'Application fee') +
      ' <span class="af-sub">non-refundable</span>';
    document.getElementById('af-fee-amount').textContent = money(shown);
  }

  /* ── Conditional sections ────────────────────────────────────────────────── */

  function syncConditions() {
    $all('[data-show-when]', form).forEach(function (el) {
      var rule = el.getAttribute('data-show-when');
      var not = rule.indexOf('!=') !== -1;
      var parts = rule.split(not ? '!=' : '=');
      var match = parts[1].split('|').indexOf(val(parts[0])) !== -1;
      el.hidden = not ? match : !match;
    });
    var p = program();
    var fewest = Math.min.apply(null, Object.keys(CONFIG.PROGRAMS).map(function (k) { return CONFIG.PROGRAMS[k].referees; }));
    $all('[data-referee]', form).forEach(function (row) {
      row.hidden = Number(row.getAttribute('data-referee')) > (p ? p.referees : fewest);
    });
  }

  /* ── Document uploads (one file per slot) ────────────────────────────────── */

  function fileType(file) {
    var ext = (file.name.match(/\.([a-z0-9]+)$/i) || [])[1];
    ext = ext ? ext.toLowerCase() : '';
    return FILE_TYPES[ext] || '';
  }
  function setupDoc(slot) {
    var key = slot.getAttribute('data-doc');
    var input = slot.querySelector('input[type="file"]');
    var drop = slot.querySelector('.af-drop');
    var list = slot.querySelector('.af-files');
    var later = slot.querySelector('input[type="checkbox"]');
    var allowed = (slot.getAttribute('data-types') || 'pdf doc docx odt rtf').split(' ');

    function render(problem) {
      var file = docs[key];
      list.innerHTML = '';
      if (file) {
        var li = document.createElement('li');
        li.innerHTML = icon('M7 3h7l5 5v13H7zM14 3v5h5') +
          '<span class="af-file-name">' + esc(file.name) + '</span><span class="af-file-size">' + sizeLabel(file.size) + '</span>' +
          '<button type="button" class="af-file-remove">Remove<span class="af-sr"> ' + esc(file.name) + '</span></button>';
        li.querySelector('button').addEventListener('click', function () {
          delete docs[key];
          render();
          input.focus();
          revalidate();
        });
        list.appendChild(li);
      }
      if (problem) {
        var p = document.createElement('li');
        p.className = 'af-file-problem';
        p.textContent = problem;
        list.appendChild(p);
      }
      drop.hidden = !!file;
      if (later) later.closest('.af-check').hidden = !!file;
    }
    function take(fileList) {
      var file = fileList && fileList[0];
      if (!file) return;
      var ext = (file.name.match(/\.([a-z0-9]+)$/i) || [])[1];
      if (!ext || allowed.indexOf(ext.toLowerCase()) === -1) return render('“' + file.name + '” can’t be uploaded here. Use ' + allowed.filter(function (x) { return x !== 'jpeg'; }).join(', ').toUpperCase() + '.');
      if (file.size > CONFIG.MAX_FILE_BYTES) return render('“' + file.name + '” is ' + sizeLabel(file.size) + '; the limit is 10 MB. Try saving it as a smaller PDF, or email it to the Registrar.');
      docs[key] = file;
      if (later) later.checked = false;
      render();
      saveDraft();
    }
    input.addEventListener('change', function () { take(input.files); input.value = ''; revalidate(); });
    if (later) later.addEventListener('change', function () { render(); });
    ['dragenter', 'dragover'].forEach(function (t) {
      drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('is-over'); });
    });
    ['dragleave', 'drop'].forEach(function (t) {
      drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('is-over'); });
    });
    drop.addEventListener('drop', function (e) { take(e.dataTransfer.files); revalidate(); });
    render();
  }
  function activeDocs() {
    return $all('.af-doc', form).filter(visible);
  }

  /* ── Validation ──────────────────────────────────────────────────────────── */

  var REQUIRED = {
    firstName: 'Enter your first name.', lastName: 'Enter your last name.', email: 'Enter your email address.',
    phone: 'Enter a phone number.', street: 'Enter your street address.', city: 'Enter your city.',
    region: 'Enter your province or state.', postal: 'Enter your postal or zip code.', country: 'Enter your country.',
    firstLanguage: 'Enter your first language.',
    personalName: 'Enter your personal referee’s name.', personalRelation: 'Say how your personal referee knows you.',
    signature: 'Type your full name to sign the application.'
  };
  var HOSTS = '.af-field, .af-choices, .af-doc, .af-edu-rows';

  function setError(target, message) {
    var host = target.closest(HOSTS);
    if (!host) return;
    var box = host.querySelector(':scope > .af-error-msg');
    if (!box) {
      box = document.createElement('p');
      box.className = 'af-error-msg';
      box.id = (target.id || target.name || 'x') + '-error';
      host.appendChild(box);
    }
    box.textContent = message;
    host.classList.add('has-error');
    $all('input, textarea, select', host).forEach(function (el) {
      if (el.type !== 'file') { el.setAttribute('aria-invalid', 'true'); el.setAttribute('aria-errormessage', box.id); }
    });
  }
  function clearErrors() {
    $all('.af-error-msg', form).forEach(function (e) { e.remove(); });
    $all('.has-error', form).forEach(function (e) { e.classList.remove('has-error'); });
    $all('[aria-invalid]', form).forEach(function (e) { e.removeAttribute('aria-invalid'); e.removeAttribute('aria-errormessage'); });
  }
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  /** Returns the first problem element, or null when the form is complete. */
  function validate() {
    clearErrors();
    var first = null;
    function fail(el, msg) { setError(el, msg); if (!first) first = el; }
    function need(name, msg) { var el = form.elements[name]; if (el && visible(el) && !val(name)) fail(el, msg || REQUIRED[name]); }

    ['firstName', 'lastName', 'email', 'phone', 'street', 'city', 'region', 'postal', 'country'].forEach(function (n) { need(n); });
    if (val('email') && !EMAIL.test(val('email'))) fail(form.elements.email, 'Check your email address; it should look like name@example.com.');
    need('permanentAddress', 'Enter your permanent address, or tick “same as my mailing address”.');

    if (!val('program')) fail(form.elements.program[0], 'Choose a program.');
    if (form.elements.concentration && visible(form.elements.concentration[0]) && !val('concentration')) fail(form.elements.concentration[0], 'Choose a concentration.');
    if (!val('start')) fail(startSelect, val('program') ? 'Choose when you would like to start.' : 'Choose your program, then your start term.');

    var edu = readEducation();
    var firstEduInput = eduRows.querySelector('input');
    if (!edu.length) fail(firstEduInput, 'List at least one post-secondary institution.');
    else if (edu.some(function (r) { return !r.institution; })) {
      var blank = $all('.af-edu-row', eduRows).filter(function (r) { return !r.querySelector('[data-edu="institution"]').value.trim() && (r.querySelector('[data-edu="degree"]').value.trim() || r.querySelector('[data-edu="year"]').value.trim()); })[0];
      fail(blank ? blank.querySelector('input') : firstEduInput, 'Add the institution’s name and location to each row.');
    }

    need('firstLanguage');
    if (!val('english')) fail(form.elements.english[0], 'Tell us how you will show your English proficiency.');

    $all('[data-referee]', form).filter(visible).forEach(function (row) {
      var n = row.getAttribute('data-referee');
      if (!val('refName' + n)) fail(form.elements['refName' + n], 'Enter this referee’s name.');
      if (!val('refInstitution' + n)) fail(form.elements['refInstitution' + n], 'Enter this referee’s institution.');
      if (val('refEmail' + n) && !EMAIL.test(val('refEmail' + n))) fail(form.elements['refEmail' + n], 'Check this email address.');
    });
    need('personalName');
    need('personalRelation');
    if (val('personalEmail') && !EMAIL.test(val('personalEmail'))) fail(form.elements.personalEmail, 'Check this email address.');

    activeDocs().forEach(function (slot) {
      var key = slot.getAttribute('data-doc');
      var later = slot.querySelector('input[type="checkbox"]');
      if (!docs[key] && !(later && later.checked)) fail(slot.querySelector('input[type="file"]'), slot.getAttribute('data-missing'));
    });

    need('transcripts', 'Confirm that you will arrange for your transcripts to be sent.');
    need('references', 'Confirm that you will ask your referees to send their letters.');
    need('declaration', 'Confirm that your application is complete and accurate.');
    need('signature');
    return first;
  }

  function showError(html) {
    errorBox.innerHTML = html;
    errorBox.hidden = false;
  }
  function hideError() { errorBox.hidden = true; errorBox.innerHTML = ''; }

  function jumpTo(el) {
    var host = el.closest(HOSTS) || el;
    host.scrollIntoView({ behavior: SCROLL, block: 'center' });
    setTimeout(function () { el.focus({ preventScroll: true }); }, 350);
  }
  function checkBeforePaying() {
    attempted = true;
    var first = validate();
    if (!first) { hideError(); return true; }
    var count = $all('.af-error-msg', form).length;
    showError('<strong>' + (count === 1 ? 'One answer needs' : count + ' answers need') + ' attention</strong> before you ' + (paidOrderId ? 'send' : 'pay') + '. ' +
      '<a href="#' + (first.id || 'application') + '" class="af-jump">Go to the first one</a>.');
    jumpTo(first);
    return false;
  }
  errorBox.addEventListener('click', function (e) {
    if (!e.target.closest('.af-jump')) return;
    e.preventDefault();
    var first = validate();
    if (first) jumpTo(first);
  });

  /* ── Sending ─────────────────────────────────────────────────────────────── */

  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve({ name: file.name, type: fileType(file), data: String(r.result).split(',')[1] }); };
      r.onerror = function () { reject(r.error); };
      r.readAsDataURL(file);
    });
  }

  function payload() {
    var p = program();
    var data = {
      ref: ref, orderId: paidOrderId, fee: paidFee,
      firstName: val('firstName'), lastName: val('lastName'), email: val('email'), phone: val('phone'),
      street: val('street'), city: val('city'), region: val('region'), postal: val('postal'), country: val('country'),
      permanentAddress: val('sameAddress') ? '' : val('permanentAddress'),
      program: val('program'), concentration: form.elements.concentration && visible(form.elements.concentration[0]) ? val('concentration') : '',
      start: val('start'),
      education: readEducation(),
      baccThesis: val('baccThesis'), mastersThesis: val('mastersThesis'),
      firstLanguage: val('firstLanguage'), otherLanguages: val('otherLanguages'), english: val('english'),
      referees: $all('[data-referee]', form).filter(visible).map(function (row) {
        var n = row.getAttribute('data-referee');
        return { name: val('refName' + n), institution: val('refInstitution' + n), email: val('refEmail' + n) };
      }).slice(0, p ? p.referees : 3),
      personal: { name: val('personalName'), relationship: val('personalRelation'), email: val('personalEmail') },
      transcripts: !!val('transcripts'), references: !!val('references'), declaration: !!val('declaration'),
      signature: val('signature'),
      documents: {}
    };
    var slots = activeDocs();
    return Promise.all(slots.map(function (slot) {
      var key = slot.getAttribute('data-doc');
      return docs[key] ? readFile(docs[key]) : Promise.resolve(null);
    })).then(function (files) {
      slots.forEach(function (slot, i) {
        data.documents[slot.getAttribute('data-doc')] = files[i] ? { file: files[i] } : { later: true };
      });
      return data;
    });
  }

  function showState(html) {
    stateBox.innerHTML = html;
    stateBox.hidden = false;
    form.hidden = true;
    stateBox.scrollIntoView({ behavior: SCROLL, block: 'start' });
    stateBox.focus({ preventScroll: true });
  }

  function send() {
    var uploading = activeDocs().some(function (slot) { return docs[slot.getAttribute('data-doc')]; });
    showState(
      '<div class="af-sending">' +
      '<h3>Sending your application</h3>' +
      '<p>Your payment went through. Please keep this page open while we send your application' + (uploading ? ' and documents' : '') + '; it can take up to a minute.</p>' +
      '<div class="af-sending-rule" aria-hidden="true"></div></div>');

    payload().then(function (data) {
      return fetch(CONFIG.SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },  // a "simple" request: no CORS preflight
        body: JSON.stringify(data)
      });
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (res) {
      if (res.ok) return succeed();
      sendFailed(res.message || 'Your application could not be saved.', res.error === 'payment');
    }).catch(function (err) {
      console.error('Application send failed:', err);
      sendFailed('We couldn’t reach our application server. This is usually a brief connection problem.', false);
    });
  }

  function succeed() {
    var later = activeDocs().filter(function (slot) { return !docs[slot.getAttribute('data-doc')]; })
      .map(function (slot) { return slot.getAttribute('data-name'); });
    clearDraft();
    showState(
      '<div class="af-done">' +
      '<h3>Thank you, ' + esc(val('firstName')) + '. Your application is in.</h3>' +
      '<p>We’ve emailed a confirmation to <strong>' + esc(val('email')) + '</strong>, and your PayPal receipt will arrive separately. ' +
      (later.length ? 'Please email your ' + esc(later.join(' and ').toLowerCase()) + ' to <a href="mailto:' + REGISTRAR + '?subject=' + encodeURIComponent('Application documents (' + ref + ')') + '">' + REGISTRAR + '</a>, quoting your reference. ' : '') +
      'Your application is complete once your transcripts and reference letters arrive, and the Academic Registrar will write to you about admission.</p>' +
      '<dl class="af-facts"><div><dt>Your reference</dt><dd>' + esc(ref) + '</dd></div>' +
      '<div><dt>PayPal order</dt><dd>' + esc(paidOrderId) + '</dd></div></dl>' +
      '</div>');
    paidOrderId = null;
  }

  /* Payment taken but the application didn't arrive: keep everything, offer a resend. */
  function sendFailed(message, paymentProblem) {
    stateBox.hidden = true;
    form.hidden = false;
    var mail = 'mailto:' + REGISTRAR + '?subject=' + encodeURIComponent(CONFIG.SERVICE + ' application (' + ref + ')') +
      '&body=' + encodeURIComponent('My application fee was paid (PayPal order ' + paidOrderId + ', reference ' + ref + ') but the application did not go through.');
    showError('<strong>' + esc(message) + '</strong> ' +
      (paymentProblem
        ? 'Please <a href="' + mail + '">write to the Academic Registrar</a> and quote PayPal order ' + esc(paidOrderId) + '.'
        : 'Your payment is safe (PayPal order ' + esc(paidOrderId) + '), and you won’t be charged again. Press <em>Send application</em> to try once more, or <a href="' + mail + '">write to the Registrar</a>.'));
    renderPaySlot();
    errorBox.scrollIntoView({ behavior: SCROLL, block: 'center' });
    errorBox.focus({ preventScroll: true });
  }

  /* ── PayPal ──────────────────────────────────────────────────────────────── */

  function renderPaySlot() {
    form.querySelector('.af-pay-lede').hidden = !CONFIG.SCRIPT_URL || !!paidOrderId;
    if (!CONFIG.SCRIPT_URL) {
      paySlot.innerHTML = '<p class="af-pay-status">Online applications open shortly. Until then, please <a href="mailto:' + REGISTRAR +
        '?subject=' + encodeURIComponent(CONFIG.SERVICE + ' application') + '">write to the Academic Registrar</a> to apply.</p>';
      return;
    }
    if (paidOrderId) {
      // Already paid: never show the payment buttons again for this application.
      paySlot.innerHTML = '<p class="af-pay-status is-paid">' + icon('M5 12.5l4.5 4.5L19 7') + 'Fee paid · PayPal order ' + esc(paidOrderId) + '</p>' +
        '<button type="button" class="af-send">Send application</button>';
      paySlot.querySelector('.af-send').addEventListener('click', function () {
        if (checkBeforePaying()) send();
      });
      return;
    }
    if (!window.paypal) { loadPayPal(); return; }

    paySlot.innerHTML = '';
    window.paypal.Buttons({
      style: { layout: 'vertical', color: 'blue', shape: 'rect', label: 'pay', height: 48 },
      onClick: function (data, actions) {
        return checkBeforePaying() ? actions.resolve() : actions.reject();
      },
      createOrder: function (data, actions) {
        var p = program(), t = chosenTerm(), amount = fee();
        return actions.order.create({
          purchase_units: [{
            description: (CONFIG.SERVICE + ' application fee | ' + (p ? p.name : '') + (t ? ', ' + t.label : '') + ' | ' + val('firstName') + ' ' + val('lastName')).slice(0, 127),
            custom_id: ref,
            invoice_id: ref,
            amount: { currency_code: 'CAD', value: amount.toFixed(2) }
          }],
          application_context: { brand_name: 'Institute for Christian Studies', shipping_preference: 'NO_SHIPPING' }
        }).then(function (id) { paidFee = amount; return id; });
      },
      onApprove: function (data, actions) {
        return actions.order.capture().then(function (details) {
          paidOrderId = details.id || data.orderID;
          saveDraft();
          syncFee();
          send();
        });
      },
      onCancel: function () {
        paidFee = null;
        showError('Payment cancelled. Your application hasn’t been sent; you can pay whenever you’re ready.');
      },
      onError: function (err) {
        paidFee = null;
        console.error('PayPal error:', err);
        if (String(err && err.message || err).indexOf('DUPLICATE_INVOICE_ID') !== -1) {
          showError('<strong>This application has already been paid for.</strong> Please <a href="mailto:' + REGISTRAR + '?subject=' +
            encodeURIComponent(CONFIG.SERVICE + ' application (' + ref + ')') + '">write to the Academic Registrar</a> and quote reference ' + esc(ref) + '.');
        } else {
          showError('<strong>The payment didn’t go through.</strong> You haven’t been charged. Please try again, or <a href="mailto:' + REGISTRAR + '">write to the Registrar</a> if it keeps happening.');
        }
      }
    }).render(paySlot);
  }

  var paypalRequested = false;
  function loadPayPal() {
    if (paypalRequested) return;
    paypalRequested = true;
    var s = document.createElement('script');
    s.src = 'https://www.paypal.com/sdk/js?client-id=' + encodeURIComponent(CONFIG.PAYPAL_CLIENT_ID) +
      '&currency=CAD&intent=capture&components=buttons&disable-funding=paylater';
    s.async = true;
    s.onload = renderPaySlot;
    s.onerror = function () {
      paySlot.innerHTML = '<p class="af-pay-status">The payment buttons didn’t load. Check your connection and reload the page; your answers are saved on this device.</p>';
    };
    document.head.appendChild(s);
  }

  /* ── Wire up ─────────────────────────────────────────────────────────────── */

  form.hidden = false;  // without JavaScript the page shows a <noscript> alternative instead

  // A page may preselect a program (the education site has one page per program).
  var preset = form.getAttribute('data-program');
  if (preset && !(draft.fields && draft.fields.program)) {
    $all('input[name="program"]', form).forEach(function (r) { r.checked = r.value === preset; });
  }
  restoreDraft();
  syncTerms();
  restoreDraft(['start']);  // start options exist only once the program is known
  syncFee();
  (draft.education && draft.education.length ? draft.education : [null]).forEach(addEduRow);
  $all('.af-doc', form).forEach(setupDoc);
  syncConditions();

  /* After a first attempt, errors update as the applicant fixes them. */
  function revalidate() {
    if (!attempted) return;
    if (!validate()) { hideError(); return; }
    var count = $all('.af-error-msg', form).length;
    var strong = errorBox.querySelector('strong');
    if (strong && /attention/.test(strong.textContent)) strong.textContent = count === 1 ? 'One answer needs attention' : count + ' answers need attention';
  }

  form.addEventListener('input', function () { saveDraft(); revalidate(); });
  form.addEventListener('change', function (e) {
    if (e.target.name === 'program') syncTerms();
    if (e.target.name === 'start') syncFee();
    if (e.target.type === 'radio' || e.target.type === 'checkbox' || e.target.tagName === 'SELECT') syncConditions();
    saveDraft();
    revalidate();
  });
  form.addEventListener('submit', function (e) { e.preventDefault(); });

  // Load PayPal only when the applicant gets near the form.
  if (!CONFIG.SCRIPT_URL || paidOrderId || !('IntersectionObserver' in window)) {
    renderPaySlot();
  } else {
    var io = new IntersectionObserver(function (entries) {
      if (entries.some(function (en) { return en.isIntersecting; })) { io.disconnect(); renderPaySlot(); }
    }, { rootMargin: '1200px 0px' });
    io.observe(form);
  }

  // A payment from an earlier visit that never reached us: offer to send it.
  if (paidOrderId && CONFIG.SCRIPT_URL) {
    showError('<strong>Your fee was paid on an earlier visit</strong> (PayPal order ' + esc(paidOrderId) + '), but the application wasn’t sent. ' +
      'Check your answers, add any documents again, and press <em>Send application</em>.');
  }
})();

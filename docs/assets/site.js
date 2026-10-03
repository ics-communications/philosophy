/* ICS MA & PhD site behaviour. Everything here is progressive enhancement:
   every page is complete with JavaScript off. */

/* ── Masthead navigation, copied from faculty.icscanada.edu js/site.js
      (reference/faculty-nav/nav.js, 2026-10-02) ───────────────────────── */
(function () {
  'use strict';

  document.documentElement.classList.add('js');

  /* ── Mobile menu ─────────────────────────────────────────────── */
  var burger = document.querySelector('.ics-burger');
  var menu = document.getElementById('mobileMenu');

  function closeMenu() {
    if (!menu) return;
    menu.classList.remove('is-open');
    document.body.style.overflow = '';
    if (burger) {
      burger.setAttribute('aria-expanded', 'false');
      burger.focus();
    }
  }

  if (burger && menu) {
    burger.setAttribute('aria-expanded', 'false');
    burger.setAttribute('aria-controls', 'mobileMenu');
    burger.addEventListener('click', function () {
      menu.classList.add('is-open');
      document.body.style.overflow = 'hidden';
      burger.setAttribute('aria-expanded', 'true');
      var close = menu.querySelector('.ics-mobile-menu__close');
      if (close) close.focus();
    });
    var closeBtn = menu.querySelector('.ics-mobile-menu__close');
    if (closeBtn) closeBtn.addEventListener('click', closeMenu);
    menu.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') closeMenu();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && menu.classList.contains('is-open')) closeMenu();
    });
  }

  /* ── Desktop dropdowns: hover opens them in CSS, this is for keyboards ── */
  Array.prototype.forEach.call(
    document.querySelectorAll('.ics-nav__item > button'),
    function (btn) {
      btn.addEventListener('click', function () {
        var open = this.getAttribute('aria-expanded') === 'true';
        this.setAttribute('aria-expanded', open ? 'false' : 'true');
      });
    }
  );

})();

/* ── Off-site links open in a new tab ──────────────────────────────────
   The site is framed inside Google Sites, whose sandbox ignores
   target="_top" and whose sister hosts refuse framing. The generated HTML
   already carries target="_blank"; this catches anything added later.
   mailto: links are left alone. */
(function () {
  'use strict';
  var here = location.host;
  Array.prototype.forEach.call(document.querySelectorAll('a[href]'), function (a) {
    var href = a.getAttribute('href');
    if (!/^https?:\/\//i.test(href)) return;
    if (a.host === here) return;
    a.setAttribute('target', '_blank');
    var rel = (a.getAttribute('rel') || '').split(/\s+/);
    if (rel.indexOf('noopener') === -1) rel.push('noopener');
    a.setAttribute('rel', rel.join(' ').trim());
  });
})();

/* ── “Your time”: every Eastern-Time seminar is re-set in the visitor's
      own time zone, and the season in session is marked. ─────────────── */
(function () {
  'use strict';
  if (!window.Intl || !Intl.DateTimeFormat) return;

  var TZ = 'America/Toronto';
  var userZone;
  try { userZone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return; }

  // Toronto's UTC offset (minutes) at a given instant.
  function torontoOffset(date) {
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    }).formatToParts(date);
    var get = function (type) {
      for (var i = 0; i < parts.length; i++) if (parts[i].type === type) return +parts[i].value;
      return 0;
    };
    var asUTC = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'));
    return Math.round((asUTC - date.getTime()) / 60000);
  }

  // "2027-02-10T14:00" read as Toronto wall-clock time.
  function fromToronto(stamp) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(stamp);
    if (!m) return null;
    var guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    var off = torontoOffset(new Date(guess));
    return new Date(guess - off * 60000);
  }

  // Set as type: two-digit 24-hour times where the visitor's locale uses a
  // 24-hour clock (00:00–03:00), the locale's 12-hour form otherwise.
  var cycle = '';
  try { cycle = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hourCycle || ''; } catch (e) {}
  var timeFmt = /h2[34]/.test(cycle)
    ? new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    : new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  var dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
  var torontoDay = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: TZ });
  var userDay = new Intl.DateTimeFormat('en-US', { weekday: 'short' });
  // The zone's short name on that date (CET in February, CEST in October).
  function zoneName(date) {
    try {
      return new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
        .formatToParts(date).filter(function (p) { return p.type === 'timeZoneName'; })[0].value;
    } catch (e) { return ''; }
  }

  var meets = document.querySelectorAll('.meet[data-start]');
  var shown = 0;
  Array.prototype.forEach.call(meets, function (el) {
    var start = fromToronto(el.getAttribute('data-start'));
    var end = fromToronto(el.getAttribute('data-end'));
    if (!start || !end) return;
    // Same offset as Toronto at that moment: nothing to add.
    if (-start.getTimezoneOffset() === torontoOffset(start)) return;
    var sameDay = userDay.format(start) === torontoDay.format(start);
    var local = document.createElement('span');
    local.className = 'meet__local';
    local.textContent = (sameDay ? '' : dayFmt.format(start) + ' ') +
      timeFmt.format(start) + '–' + timeFmt.format(end) + ' your time' + (zoneName(start) ? ' (' + zoneName(start) + ')' : '');
    el.appendChild(local);
    shown++;
  });

  if (shown) {
    Array.prototype.forEach.call(document.querySelectorAll('.your-time-note'), function (n) { n.hidden = false; });
    var reveal = function () {
      Array.prototype.forEach.call(document.querySelectorAll('.meet__local'), function (n) { n.classList.add('is-in'); });
    };
    if (window.requestAnimationFrame) requestAnimationFrame(function () { requestAnimationFrame(reveal); });
    else reveal();
  }

  // Mark the season in session (by month; terms are Sept–Dec, Jan–Apr, May–Aug).
  var now = new Date();
  var ym = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  Array.prototype.forEach.call(document.querySelectorAll('.season[data-from]'), function (s) {
    if (ym >= s.getAttribute('data-from') && ym <= s.getAttribute('data-to')) {
      s.classList.add('is-now');
      var mark = s.querySelector('.season__now');
      if (mark) mark.hidden = false;
    }
  });
})();

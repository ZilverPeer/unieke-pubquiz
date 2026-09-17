// PROTOTYPE, throwaway — see index.html top comment.
(function () {
  'use strict';

  var VARIANTS = [
    { key: 'A', name: 'Configurator first' },
    { key: 'B', name: 'Story first' },
    { key: 'C', name: 'Compact card' }
  ];

  var body = document.body;
  var label = document.getElementById('switcher-label');
  var prevBtn = document.getElementById('switcher-prev');
  var nextBtn = document.getElementById('switcher-next');

  function currentIndex() {
    var v = body.getAttribute('data-active-variant');
    for (var i = 0; i < VARIANTS.length; i++) {
      if (VARIANTS[i].key === v) return i;
    }
    return 0;
  }

  function setVariant(key) {
    body.setAttribute('data-active-variant', key);
    var entry = VARIANTS.filter(function (v) { return v.key === key; })[0];
    label.textContent = entry.key + ' — ' + entry.name;
    var params = new URLSearchParams(window.location.search);
    params.set('variant', key);
    var newUrl = window.location.pathname + '?' + params.toString();
    history.replaceState(null, '', newUrl);
  }

  function initVariant() {
    var params = new URLSearchParams(window.location.search);
    var requested = (params.get('variant') || 'A').toUpperCase();
    var valid = VARIANTS.some(function (v) { return v.key === requested; });
    setVariant(valid ? requested : 'A');
  }

  function step(delta) {
    var idx = currentIndex();
    var nextIdx = (idx + delta + VARIANTS.length) % VARIANTS.length;
    setVariant(VARIANTS[nextIdx].key);
  }

  prevBtn.addEventListener('click', function () { step(-1); });
  nextBtn.addEventListener('click', function () { step(1); });

  document.addEventListener('keydown', function (e) {
    var target = e.target;
    var tag = target && target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (target && target.isContentEditable)) {
      return;
    }
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'ArrowRight') step(1);
  });

  initVariant();

  // ---- configurator behaviour: chips with an 8-pick cap ----
  Array.prototype.forEach.call(document.querySelectorAll('.chips'), function (chipGroup) {
    var max = parseInt(chipGroup.getAttribute('data-max'), 10) || 8;
    var capMessage = chipGroup.parentElement.querySelector('.cap-message');
    var chips = chipGroup.querySelectorAll('.chip');

    Array.prototype.forEach.call(chips, function (chip) {
      chip.setAttribute('aria-pressed', 'false');
      chip.addEventListener('click', function () {
        var selected = chipGroup.querySelectorAll('.chip[aria-pressed="true"]');
        var isSelected = chip.getAttribute('aria-pressed') === 'true';

        if (!isSelected && selected.length >= max) {
          if (capMessage) {
            capMessage.hidden = false;
            setTimeout(function () { capMessage.hidden = true; }, 2500);
          }
          return;
        }

        chip.setAttribute('aria-pressed', isSelected ? 'false' : 'true');
        if (capMessage) capMessage.hidden = true;
      });
    });
  });

  // ---- Bestellen: prototype feedback only, no submission ----
  Array.prototype.forEach.call(document.querySelectorAll('.btn-bestellen'), function (btn) {
    btn.addEventListener('click', function () {
      var feedback = btn.closest('.configurator').querySelector('.prototype-feedback');
      if (!feedback) return;
      feedback.hidden = false;
      clearTimeout(feedback._timer);
      feedback._timer = setTimeout(function () { feedback.hidden = true; }, 3000);
    });
  });
})();

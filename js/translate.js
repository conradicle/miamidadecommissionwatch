var MDCW_LANG_KEY = 'mdcw_lang';

function mdcwSetActiveButton(lang) {
  var buttons = document.querySelectorAll('.lang-btn');
  for (var i = 0; i < buttons.length; i++) {
    var isActive = buttons[i].getAttribute('data-lang') === lang;
    if (isActive) {
      buttons[i].classList.add('active');
    } else {
      buttons[i].classList.remove('active');
    }
    buttons[i].setAttribute('aria-pressed', isActive ? 'true' : 'false');
  }
}

/* Google stores the active language in a `googtrans` cookie and re-applies it on
   every page load. Reloading without clearing it just re-translates the page, so
   switching back to English has to delete the cookie first. Google writes it on
   both the bare host and the dot-prefixed registrable domain, so clear each. */
function mdcwClearGoogleCookie() {
  var host = window.location.hostname;
  var domains = ['', host, '.' + host];
  var parts = host.split('.');
  if (parts.length > 2) {
    domains.push('.' + parts.slice(1).join('.'));
  }
  for (var i = 0; i < domains.length; i++) {
    document.cookie = 'googtrans=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' +
      (domains[i] ? '; domain=' + domains[i] : '');
  }
}

/* The widget renders `select.goog-te-combo` empty and fills in its options a
   moment later. Assigning a value the select does not have yet is silently
   dropped, so wait for the option itself, not just the select. */
function mdcwWaitForSelectAndApply(lang, attemptsLeft) {
  if (attemptsLeft === undefined) attemptsLeft = 60;
  var select = document.querySelector('select.goog-te-combo');
  if (select && select.querySelector('option[value="' + lang + '"]')) {
    if (select.value !== lang) {
      select.value = lang;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return;
  }
  if (attemptsLeft > 0) {
    setTimeout(function () {
      mdcwWaitForSelectAndApply(lang, attemptsLeft - 1);
    }, 250);
  }
}

function googleTranslateElementInit() {
  new google.translate.TranslateElement({
    pageLanguage: 'en',
    includedLanguages: 'en,es,ht',
    autoDisplay: false
  }, 'google_translate_element');

  var stored = localStorage.getItem(MDCW_LANG_KEY) || 'en';
  if (stored !== 'en') {
    mdcwWaitForSelectAndApply(stored);
  }
}

function mdcwSwitchLanguage(lang) {
  var current = localStorage.getItem(MDCW_LANG_KEY) || 'en';
  localStorage.setItem(MDCW_LANG_KEY, lang);
  mdcwSetActiveButton(lang);
  if (lang === 'en') {
    if (current === 'en') return;
    mdcwClearGoogleCookie();
    window.location.reload();
    return;
  }
  mdcwWaitForSelectAndApply(lang);
}

document.addEventListener('DOMContentLoaded', function () {
  mdcwSetActiveButton(localStorage.getItem(MDCW_LANG_KEY) || 'en');

  var buttons = document.querySelectorAll('.lang-btn');
  for (var i = 0; i < buttons.length; i++) {
    buttons[i].addEventListener('click', function () {
      mdcwSwitchLanguage(this.getAttribute('data-lang'));
    });
  }
});

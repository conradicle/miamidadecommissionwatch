var MDCW_LANG_KEY = 'mdcw_lang';

function mdcwSetActiveButton(lang) {
  var buttons = document.querySelectorAll('.lang-btn');
  for (var i = 0; i < buttons.length; i++) {
    if (buttons[i].getAttribute('data-lang') === lang) {
      buttons[i].classList.add('active');
    } else {
      buttons[i].classList.remove('active');
    }
  }
}

function mdcwWaitForSelectAndApply(lang, attemptsLeft) {
  if (attemptsLeft === undefined) attemptsLeft = 30;
  var select = document.querySelector('select.goog-te-combo');
  if (select) {
    if (select.value !== lang) {
      select.value = lang;
      select.dispatchEvent(new Event('change'));
    }
  } else if (attemptsLeft > 0) {
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
  localStorage.setItem(MDCW_LANG_KEY, lang);
  mdcwSetActiveButton(lang);
  if (lang === 'en') {
    location.reload();
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

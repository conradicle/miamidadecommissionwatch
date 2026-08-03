function googleTranslateElementInit() {
  new google.translate.TranslateElement({
    pageLanguage: 'en',
    includedLanguages: 'en,es,ht',
    autoDisplay: false
  }, 'google_translate_element');
}

(function () {
  function getCookie(name) {
    var match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  }

  function setCookie(name, value) {
    var host = location.hostname;
    var base = name + '=' + value + '; path=/;';
    document.cookie = base;
    document.cookie = base + ' domain=' + host + ';';
    var bareDomain = host.replace(/^www\./, '');
    if (bareDomain !== host) {
      document.cookie = base + ' domain=.' + bareDomain + ';';
    }
  }

  function clearCookie(name) {
    var expired = 'expires=Thu, 01 Jan 1970 00:00:00 UTC;';
    document.cookie = name + '=; ' + expired + ' path=/;';
    document.cookie = name + '=; ' + expired + ' path=/; domain=' + location.hostname + ';';
  }

  function currentLang() {
    var cookie = getCookie('googtrans');
    if (!cookie) return 'en';
    var parts = cookie.split('/');
    return parts[2] || 'en';
  }

  function setActiveButton(lang) {
    var buttons = document.querySelectorAll('.lang-btn');
    for (var i = 0; i < buttons.length; i++) {
      if (buttons[i].getAttribute('data-lang') === lang) {
        buttons[i].classList.add('active');
      } else {
        buttons[i].classList.remove('active');
      }
    }
  }

  function switchLanguage(lang) {
    if (lang === 'en') {
      clearCookie('googtrans');
    } else {
      setCookie('googtrans', '/en/' + lang);
    }
    location.reload();
  }

  document.addEventListener('DOMContentLoaded', function () {
    setActiveButton(currentLang());

    var buttons = document.querySelectorAll('.lang-btn');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener('click', function () {
        switchLanguage(this.getAttribute('data-lang'));
      });
    }
  });
})();

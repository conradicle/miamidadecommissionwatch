// How a student's name is allowed to appear on a public page.
//
// Everyone who submits an editorial is a Miami-Dade high school student, i.e. a
// minor. Public pages therefore show first name + last initial and nothing
// else: no full surname, no grade, no school, no school email. The full details
// are still collected, still stored, and still shown in the admin dashboard for
// review and record-keeping — they just never reach a visitor.
//
// Plain global, matching the rest of js/ (no build step, no modules). This is
// the only copy of this logic; call it, don't reimplement it.
(function () {
  // Surname particles. When one of these turns up after the first word it marks
  // where the surname begins, which beats guessing from the word count.
  var PARTICLES = [
    'de', 'del', 'della', 'di', 'da', 'das', 'dos', 'du', 'la', 'las', 'le',
    'los', 'van', 'von', 'der', 'den', 'ter', 'al', 'bin', 'ibn', 'y', 'i',
    'san', 'st', 'mac', 'mc', 'o'
  ];

  function isParticle(token) {
    return PARTICLES.indexOf(token.toLowerCase().replace(/[.'’]/g, '')) !== -1;
  }

  // First letter of the surname, accents included (Ángel -> Á, not a blank).
  function firstLetter(token) {
    var match = String(token).match(/[A-Za-z\u00C0-\u024F]/);
    return match ? match[0].toUpperCase() : '';
  }

  // "Stefano Sanchez"            -> "Stefano S."
  // "Ana Maria Gonzalez Perez"   -> "Ana Maria G."
  // "Maria Gonzalez-Perez"       -> "Maria G."
  // "Ana de la Cruz"             -> "Ana C."
  // "Cher"                       -> "Cher"
  // "" / null / undefined        -> ""
  function publicByline(fullName) {
    var tokens = String(fullName == null ? '' : fullName)
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter(function (token) { return token.length > 0; });

    if (tokens.length === 0) return '';
    // One word is already as short as it gets, and there's no surname to reduce.
    if (tokens.length === 1) return tokens[0];

    var surnameStart = -1;
    for (var i = 1; i < tokens.length; i++) {
      if (isParticle(tokens[i])) {
        surnameStart = i;
        break;
      }
    }

    if (surnameStart === -1) {
      // No particle to anchor on, so split on word count. Spanish naming is
      // common here and pairs up ("Ana Maria" + "Gonzalez Perez"), so an even
      // count splits down the middle. An odd count is genuinely ambiguous
      // ("Ana Maria Gonzalez" vs "Ana Gonzalez Perez") and we round toward
      // fewer given names on purpose: printing one given name too few is a
      // cosmetic miss, printing a full surname is the leak we're stopping.
      surnameStart = Math.max(1, Math.floor(tokens.length / 2));
    }

    var given = tokens.slice(0, surnameStart).join(' ');

    // Step past any particles to reach the surname the initial comes from.
    var initial = '';
    for (var j = surnameStart; j < tokens.length; j++) {
      if (isParticle(tokens[j])) continue;
      initial = firstLetter(tokens[j]);
      if (initial) break;
    }

    return initial ? given + ' ' + initial + '.' : given;
  }

  window.publicByline = publicByline;
})();

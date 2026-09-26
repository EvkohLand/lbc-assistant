// Retire du texte généré les marques typiques d'une IA : tirets cadratins,
// guillemets typographiques, émojis, markdown, formules toutes faites.
(function (root) {
  'use strict';

  // Formules qui trahissent un texte généré. Remplacées ou supprimées.
  // Frontières de mot compatibles avec les lettres accentuées.
  const W = (src) => new RegExp('(?<![\\p{L}])' + src + '(?![\\p{L}])', 'giu');
  const CLICHES = [
    [W("n'hésitez (?:surtout )?pas à me contacter(?: pour (?:plus d'informations|toute question))?"), 'Contactez-moi pour toute question'],
    [W("ne (?:manquez|ratez) pas (?:cette )?(?:belle |superbe )?(?:occasion|opportunité)\\s*!?"), ''],
    [W('(?:véritable|vrai) (?:allié|compagnon)(?: idéal)?'), 'objet pratique'],
    [W('un incontournable'), 'un objet très pratique'],
    [W('incontournable'), 'pratique'],
    [W('sublimer'), 'mettre en valeur'],
    [W('en somme,?\\s*'), ''],
    [W('il est important de (?:noter|souligner) que\\s*'), ''],
    [W('il convient de noter que\\s*'), ''],
    [W('alliant'), 'avec'],
  ];

  const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]/gu;

  function humanizeLine(line) {
    let s = line;
    // Tirets cadratin / demi-cadratin / moins typographique
    s = s.replace(/\s+[—–‒―−]\s+/g, ', ');
    s = s.replace(/[—–‒―−]/g, '-');
    // Puces typographiques en début de ligne
    s = s.replace(/^\s*[•●▪▸►‣⁃∙➤→]\s*/, '- ');
    s = s.replace(/^\s*[*+]\s+/, '- ');
    // Markdown
    s = s.replace(/^\s*#{1,6}\s+/, '');
    s = s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1');
    s = s.replace(/(^|\s)\*(\S.*?\S|\S)\*(?=\s|[.,;:!?]|$)/g, '$1$2');
    s = s.replace(/`([^`]+)`/g, '$1');
    // Guillemets et apostrophes typographiques
    s = s.replace(/[‘’‚′]/g, "'");
    s = s.replace(/[«“„]\s*/g, '"').replace(/\s*[»”″]/g, '"');
    // Points de suspension en un caractère
    s = s.replace(/…/g, '...');
    // Espaces spéciales
    s = s.replace(/[    ​]/g, ' ');
    // Émojis et symboles décoratifs
    s = s.replace(EMOJI, '');
    s = s.replace(/[★☆✓✔✖✨⭐❗❓]/g, '');
    for (const [re, rep] of CLICHES) s = s.replace(re, rep);
    // Ponctuation répétée
    s = s.replace(/!{2,}/g, '!').replace(/\?{2,}/g, '?');
    s = s.replace(/[ \t]{2,}/g, ' ').replace(/\s+([,.])/g, '$1').replace(/,\s*,/g, ',');
    return s.trim();
  }

  function humanize(text) {
    if (!text) return '';
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n').map(humanizeLine);
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  // Titre : une ligne, pas de ponctuation finale, pas de MAJUSCULES criardes.
  function humanizeTitle(title) {
    let s = humanize(title).replace(/\n+/g, ' ');
    s = s.replace(/^["']+|["']+$/g, '');
    s = s.replace(/[!?.:;,\s]+$/, '');
    s = s.replace(/\s*[|/]\s*/g, ' ');
    // Mot entièrement en capitales de plus de 4 lettres, hors sigle probable
    s = s.replace(/\b[A-ZÀ-Ý]{5,}\b/g, (w) => w.charAt(0) + w.slice(1).toLowerCase());
    s = s.replace(/\s{2,}/g, ' ').trim();
    if (s.length > 100) s = s.slice(0, 100).replace(/\s+\S*$/, '');
    return s;
  }

  const api = { humanize, humanizeTitle };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Humanize = api;
})(typeof window !== 'undefined' ? window : globalThis);

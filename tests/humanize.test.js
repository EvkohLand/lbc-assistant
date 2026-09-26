const assert = require('node:assert/strict');
const { test } = require('node:test');
const { humanize, humanizeTitle } = require('../js/humanize.js');

test('removes em and en dashes', () => {
  assert.equal(humanize('Cafetière Delonghi — très bon état'), 'Cafetière Delonghi, très bon état');
  assert.equal(humanize('Taille 38–40'), 'Taille 38-40');
});

test('removes emojis, markdown and typographic quotes', () => {
  assert.equal(humanize('✨ **Superbe** vélo 🚲 « comme neuf »'), 'Superbe vélo "comme neuf"');
  assert.equal(humanize("L’objet fonctionne…"), "L'objet fonctionne...");
});

test('normalizes bullets to plain dashes', () => {
  assert.equal(humanize('• 3 vitesses\n● Garantie'), '- 3 vitesses\n- Garantie');
});

test('rewrites AI cliches', () => {
  assert.equal(humanize('Un véritable allié au quotidien.'), 'Un objet pratique au quotidien.');
  assert.ok(!/n'hésitez/i.test(humanize("N'hésitez pas à me contacter pour plus d'informations.")));
});

test('keeps single line breaks and paragraph breaks', () => {
  assert.equal(humanize('A\n\n\n\nB\nC'), 'A\n\nB\nC');
});

test('title: no final punctuation, no shouting, max 100 chars', () => {
  assert.equal(humanizeTitle('Vélo électrique DECATHLON Rockrider — taille M !'), 'Vélo électrique Decathlon Rockrider, taille M');
  assert.ok(humanizeTitle('a '.repeat(80)).length <= 100);
  assert.equal(humanizeTitle('"Poussette Yoyo 2"'), 'Poussette Yoyo 2');
});

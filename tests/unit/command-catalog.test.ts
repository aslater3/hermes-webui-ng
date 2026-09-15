import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commandAction, commandAvailability, commandHint, commandCatalogue, commandMatches, commandChoice, slashInput, literalPrompt, COMMAND_LIMITS } from '../../src/hermes/command-catalog.js';
import { commandFixture } from '../fixtures/commands.js';

test('official catalogue shape retains bounded display fields, categories and advertised aliases only', () => {
  const catalogue = commandCatalogue({ ...commandFixture(), api_key: 'PRIVATE', warning: 'SECRET_ERROR' });
  assert.equal(catalogue.partial, true);
  assert.equal(catalogue.choices.find(row => row.name === '/help')?.aliases[0], '/h');
  assert.equal(catalogue.choices.find(row => row.name === '/default-skill')?.category, 'Skills');
  assert.equal(catalogue.choices.find(row => row.name === '/status')?.action, 'native');
  assert.ok(!JSON.stringify(catalogue).includes('PRIVATE')); assert.ok(!JSON.stringify(catalogue).includes('SECRET_ERROR'));
});

test('discovery requires explicit confirmation for native effects and unknown names remain rejected', () => {
  for (const name of ['/undo', '/retry', '/compress', '/snapshot', '/unsafe', '/default-skill', '/shell', '/config'])
    assert.equal(commandAction(name), 'confirm-native');
  assert.equal(commandChoice(commandCatalogue(commandFixture()), { name: '/unsafe', argument: '' }).action, 'confirm-native');
  assert.throws(() => commandChoice(commandCatalogue(commandFixture()), { name: '/unknown', argument: '' }));
});

test('malformed catalogues fail closed; malformed rows, recursive aliases and executable names are discarded', () => {
  for (const raw of [null, [], 'text', {}, { pairs: {} }]) assert.throws(() => commandCatalogue(raw));
  const catalogue = commandCatalogue({ pairs: [['/usage', 'Usage'], ['/usage', 'Overridden'], ['bad', 'bad'],
    ['/status;rm', 'bad'], null, ['/valid', 2]], canon: { '/a': '/b', '/b': '/a', '/x': '/usage', '/usage': '/unsafe', '/z': 'rm -rf /' } });
  assert.equal(catalogue.choices.length, 1); assert.equal(catalogue.choices[0]?.description, 'Usage');
  assert.deepEqual(catalogue.choices[0]?.aliases, ['/x']); assert.equal(catalogue.partial, true);
});

test('oversized catalogue strings, entries and alias maps are bounded', () => {
  const catalogue = commandCatalogue({ pairs: Array.from({ length: 1100 }, (_, i) => [`/c${i}`, 'x'.repeat(1000)]) });
  assert.equal(catalogue.choices.length, COMMAND_LIMITS.entries); assert.ok(catalogue.partial);
  assert.equal(catalogue.choices[0]?.description.length, COMMAND_LIMITS.description);
  assert.equal(commandMatches(catalogue, '/', 9000).length, COMMAND_LIMITS.entries);
});

test('completion ranks canonical names, aliases and descriptions without inventing commands', () => {
  const catalogue = commandCatalogue(commandFixture());
  assert.equal(commandMatches(catalogue, '/us')[0]?.name, '/usage');
  assert.equal(commandMatches(catalogue, '/h')[0]?.name, '/help');
  assert.equal(commandMatches(catalogue, 'token')[0]?.name, '/usage');
  assert.equal(commandMatches(catalogue, 'nonexistent').length, 0);
  assert.ok(commandMatches(catalogue, '/').slice(0, 8).every(row => row.action !== 'unavailable'));
});

test('slash parsing preserves deliberate literal escapes and never treats malformed slash input as chat', () => {
  assert.deepEqual(slashInput('  /USAGE '), { name: '/usage', argument: '' });
  assert.deepEqual(slashInput('/help token usage'), { name: '/help', argument: 'token usage' });
  assert.equal(slashInput('ordinary /usage text'), undefined);
  assert.equal(slashInput('//usage'), undefined); assert.equal(literalPrompt('  //usage'), '  /usage');
  assert.equal(literalPrompt('ordinary text'), 'ordinary text');
  for (const input of ['/', '/usage\n/status', '/usage\n', '/usage;whoami', '/tmp/file']) assert.throws(() => slashInput(input));
});

test('arguments cannot turn a read into a mutation; pickers require their explicit UI workflow', () => {
  const catalogue = commandCatalogue(commandFixture());
  for (const input of ['/usage reset', '/status something', '/history clear'])
    assert.throws(() => commandChoice(catalogue, slashInput(input)!));
  for (const input of ['/model other --global', '/reasoning high', '/profile work'])
    assert.equal(commandChoice(catalogue, slashInput(input)!).action, 'confirm-native');
  assert.equal(commandChoice(catalogue, slashInput('/h model')!).action, 'catalogue');
});

test('matching exposes the whole bounded catalogue, not an eight or eighty entry preview', () => {
  const catalogue = commandCatalogue({ pairs: [
    ...commandFixture().pairs,
    ...Array.from({ length: 120 }, (_, i) => [`/extra-${String(i).padStart(3, '0')}`, `Fixture command ${i}`]),
  ] });
  assert.equal(commandMatches(catalogue, '/').length, commandFixture().pairs.length + 120);
  assert.equal(commandMatches(catalogue, '/extra-119')[0]?.name, '/extra-119');
  assert.equal(commandMatches(catalogue, '/extra-11').length, 10);
  assert.equal(commandMatches(catalogue, '/', 8).length, 8, 'explicit caller bounds are still honoured');
});

test('typing progressively narrows canonical and alias matches regardless of catalogue position or case', () => {
  const catalogue = commandCatalogue(commandFixture());
  assert.ok(commandMatches(catalogue, '/').length > commandMatches(catalogue, '/u').length);
  assert.deepEqual(commandMatches(catalogue, ' /USAGE ').map(row => row.name), ['/usage', '/context']);
  assert.equal(commandMatches(catalogue, '/default-sk')[0]?.name, '/default-skill');
  assert.equal(commandMatches(catalogue, '/H')[0]?.name, '/help');
  assert.deepEqual(commandMatches(catalogue, '/zzzz'), []);
});

test('catalogue search accepts multiple terms across descriptions, aliases and categories', () => {
  const catalogue = commandCatalogue(commandFixture());
  assert.deepEqual(commandMatches(catalogue, 'SESSION token').map(row => row.name), ['/usage']);
  assert.deepEqual(commandMatches(catalogue, 'skill profile-owned').map(row => row.name), ['/default-skill']);
  assert.deepEqual(commandMatches(catalogue, 'token missing'), []);
});

test('implementation gaps and missing native support have distinct honest explanations, not permission guesses', () => {
  const catalogue = commandCatalogue(commandFixture());
  const usage = catalogue.choices.find(row => row.name === '/usage')!;
  const undo = catalogue.choices.find(row => row.name === '/undo')!;
  const skill = catalogue.choices.find(row => row.name === '/default-skill')!;
  assert.equal(commandAvailability(usage), 'Available in WebUI');
  assert.equal(commandAvailability(usage, true), 'Not supported by this Hermes version');
  assert.match(commandHint(usage, true), /does not provide the native command method/);
  assert.equal(commandAvailability(undo), 'Native command · confirmation required');
  assert.match(commandHint(undo), /review native effects/);
  assert.match(commandHint(skill), /review native effects/);
  assert.equal(commandAvailability(undo, true), 'Native command · confirmation required');
  assert.equal(commandAction(undo.name), 'confirm-native', 'native effects still require explicit owner-scoped confirmation');
});

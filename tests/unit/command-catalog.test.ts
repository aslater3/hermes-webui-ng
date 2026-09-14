import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commandAction, commandCatalogue, commandMatches, commandChoice, slashInput, literalPrompt, COMMAND_LIMITS } from '../../src/hermes/command-catalog.js';
import { commandFixture } from '../fixtures/commands.js';

test('official catalogue shape retains bounded display fields, categories and advertised aliases only', () => {
  const catalogue = commandCatalogue({ ...commandFixture(), api_key: 'PRIVATE', warning: 'SECRET_ERROR' });
  assert.equal(catalogue.partial, true);
  assert.equal(catalogue.choices.find(row => row.name === '/help')?.aliases[0], '/h');
  assert.equal(catalogue.choices.find(row => row.name === '/default-skill')?.category, 'Skills');
  assert.equal(catalogue.choices.find(row => row.name === '/status')?.action, 'native');
  assert.ok(!JSON.stringify(catalogue).includes('PRIVATE')); assert.ok(!JSON.stringify(catalogue).includes('SECRET_ERROR'));
});

test('discovery is not arbitrary execution permission and no destructive commands gain actions', () => {
  for (const name of ['/undo', '/retry', '/compress', '/snapshot', '/unsafe', '/default-skill', '/shell', '/config'])
    assert.equal(commandAction(name), 'unavailable');
  assert.throws(() => commandChoice(commandCatalogue(commandFixture()), { name: '/unsafe', argument: '' }));
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
  for (const input of ['/usage reset', '/model other --global', '/reasoning high', '/profile work', '/status something'])
    assert.throws(() => commandChoice(catalogue, slashInput(input)!));
  assert.equal(commandChoice(catalogue, slashInput('/h model')!).action, 'catalogue');
});

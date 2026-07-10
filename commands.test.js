const test = require('node:test');
const assert = require('node:assert');
const { buildCommands, uniqueGuildIds } = require('./commands');

const fromChoices = (cmd) =>
  cmd.options.find((o) => o.name === 'from_server').choices.map((c) => c.value);

test('buildCommands builds both commands with expected choices', () => {
  const byName = Object.fromEntries(buildCommands().map((c) => [c.name, c]));
  assert.deepStrictEqual(Object.keys(byName).sort(), ['bulkrepost', 'testbulkrepost']);
  assert.deepStrictEqual(fromChoices(byName.bulkrepost).sort(), [
    'closetclearout',
    'zrserver',
  ]);
  assert.deepStrictEqual(fromChoices(byName.testbulkrepost).sort(), [
    'closetclearout',
    'prinsale',
    'replinks',
    'zrserver',
  ]);
});

test('to_server choices match from_server choices for each command', () => {
  for (const cmd of buildCommands()) {
    const to = cmd.options.find((o) => o.name === 'to_server').choices.map((c) => c.value);
    assert.deepStrictEqual(to, fromChoices(cmd));
  }
});

test('every command exposes its options in order', () => {
  for (const cmd of buildCommands()) {
    assert.deepStrictEqual(
      cmd.options.map((o) => o.name),
      ['from_server', 'to_server', 'include_archived', 'posted_after']
    );
  }
});

test('uniqueGuildIds dedups shared guild ids', () => {
  const ids = uniqueGuildIds();
  assert.strictEqual(new Set(ids).size, ids.length);
  for (const id of ['1108034288366125068', '1149124608964952065', '1125269970381705226']) {
    assert.ok(ids.includes(id), `missing guild ${id}`);
  }
});

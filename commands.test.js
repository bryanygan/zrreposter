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
    'newclosetclearout',
    'zrserver',
  ]);
  assert.deepStrictEqual(fromChoices(byName.testbulkrepost).sort(), [
    'closetclearout',
    'newclosetclearout',
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

test('bulkrepost exposes from/to channel id options; testbulkrepost does not', () => {
  const byName = Object.fromEntries(buildCommands().map((c) => [c.name, c]));
  assert.deepStrictEqual(
    byName.bulkrepost.options.map((o) => o.name),
    ['from_server', 'to_server', 'from_channel_id', 'to_channel_id', 'include_archived', 'posted_after']
  );
  assert.deepStrictEqual(
    byName.testbulkrepost.options.map((o) => o.name),
    ['from_server', 'to_server', 'include_archived', 'posted_after']
  );
});

test('bulkrepost channel id options are required strings', () => {
  const byName = Object.fromEntries(buildCommands().map((c) => [c.name, c]));
  for (const name of ['from_channel_id', 'to_channel_id']) {
    const opt = byName.bulkrepost.options.find((o) => o.name === name);
    assert.strictEqual(opt.required, true);
    assert.strictEqual(opt.type, 3); // ApplicationCommandOptionType.String
  }
});

test('uniqueGuildIds dedups shared guild ids', () => {
  const ids = uniqueGuildIds();
  assert.strictEqual(new Set(ids).size, ids.length);
  for (const id of ['1108034288366125068', '1149124608964952065', '1125269970381705226']) {
    assert.ok(ids.includes(id), `missing guild ${id}`);
  }
});

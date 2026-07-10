const test = require('node:test');
const assert = require('node:assert');
const { SERVERS, COMMANDS } = require('./config');

test('config has all four servers with numeric ids', () => {
  assert.deepStrictEqual(
    Object.keys(SERVERS).sort(),
    ['closetclearout', 'prinsale', 'replinks', 'zrserver']
  );
  for (const name of Object.keys(SERVERS)) {
    assert.match(SERVERS[name].serverId, /^\d+$/);
    assert.match(SERVERS[name].forumChannelId, /^\d+$/);
  }
});

test('every command references only known servers', () => {
  for (const [cmd, names] of Object.entries(COMMANDS)) {
    for (const n of names) {
      assert.ok(SERVERS[n], `${cmd} references unknown server ${n}`);
    }
  }
});

test('commands expose the expected server options', () => {
  assert.deepStrictEqual(COMMANDS.bulkrepost, ['closetclearout', 'zrserver']);
  assert.deepStrictEqual(COMMANDS.testbulkrepost, [
    'replinks',
    'prinsale',
    'zrserver',
    'closetclearout',
  ]);
});

const test = require('node:test');
const assert = require('node:assert');
const { SERVERS } = require('./config');

test('config has both servers with ids', () => {
  assert.deepStrictEqual(Object.keys(SERVERS).sort(), ['closetclearout', 'zrserver']);
  for (const name of Object.keys(SERVERS)) {
    assert.match(SERVERS[name].serverId, /^\d+$/);
    assert.match(SERVERS[name].forumChannelId, /^\d+$/);
  }
});

const SERVERS = {
  closetclearout: {
    serverId: '1149124608964952065',
    forumChannelId: '1162475530109595869',
  },
  zrserver: {
    serverId: '1108034288366125068',
    forumChannelId: '1496003997788799026',
  },
  replinks: {
    serverId: '1125269970381705226',
    forumChannelId: '1524986829319704727',
  },
  prinsale: {
    serverId: '1108034288366125068',
    forumChannelId: '1228464779442655253',
  },
};

// Slash command name -> server names offered as from_server / to_server choices.
const COMMANDS = {
  bulkrepost: ['closetclearout', 'zrserver'],
  testbulkrepost: ['replinks', 'prinsale', 'zrserver', 'closetclearout'],
};

module.exports = { SERVERS, COMMANDS };

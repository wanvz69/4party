import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/database/database.js';
import { PartyService } from '../src/services/partyService.js';
import { lobbyOverwrites } from '../src/services/permissionService.js';
import { UserFacingError } from '../src/utils/errors.js';
import { generatePartyCode } from '../src/utils/partyCode.js';
import { RecoveryService } from '../src/services/recoveryService.js';
import { createPartyModal, joinCodeModal } from '../src/interactions/createParty.js';
import { createPanel } from '../src/embeds/createPanel.js';
import { buildPartyList } from '../src/embeds/partyList.js';
import { buildPartyLobby } from '../src/embeds/partyLobby.js';
import Database from 'better-sqlite3';
import { InactivityService } from '../src/services/inactivityService.js';
import { readFileSync } from 'node:fs';

const partyInput = {
  type: 'HOST',
  tier: 10,
  visibility: 'PUBLIC',
  name: 'Dragon Raid',
  description: 'Looking for teammates.',
};

function fixture(databasePath = ':memory:') {
  const db = openDatabase(databasePath);
  return { db, parties: new PartyService(db), close: () => db.close() };
}

function create(parties, leader = 'leader', overrides = {}) {
  return parties.createParty(leader, { ...partyInput, ...overrides });
}

function addMembers(parties, partyId, start, end) {
  for (let index = start; index <= end; index += 1) {
    parties.joinParty(partyId, `member-${index}`);
  }
}

test('creates a party with a leader, unique ID, and secure-format code', () => {
  const { db, parties, close } = fixture();
  try {
    const party = create(parties);
    assert.equal(party.members.length, 1);
    assert.equal(party.members[0].member_role, 'LEADER');
    assert.match(party.code, /^[A-HJ-NP-Z2-9]{5}$/);
    assert.equal(party.status, 'RECRUITING');
  } finally { close(); }
});

test('a leader cannot create a second active party', () => {
  const { parties, close } = fixture();
  try {
    create(parties);
    assert.throws(() => create(parties, 'leader'), UserFacingError);
  } finally { close(); }
});

test('joins a party with a valid code', () => {
  const { parties, close } = fixture();
  try {
    const party = create(parties);
    assert.equal(parties.joinByCode(party.code.toLowerCase(), 'joiner').member_count, 2);
  } finally { close(); }
});

test('a member cannot join another active party', () => {
  const { parties, close } = fixture();
  try {
    create(parties);
    const other = create(parties, 'other-leader');
    assert.throws(() => parties.joinParty(other.id, 'leader'), /sudah menjadi anggota/);
  } finally { close(); }
});

test('party reaches exactly ten members and becomes full', () => {
  const { parties, close } = fixture();
  try {
    const party = create(parties);
    addMembers(parties, party.id, 1, 9);
    const full = parties.getParty(party.id);
    assert.equal(full.member_count, 10);
    assert.equal(full.status, 'FULL');
  } finally { close(); }
});

test('rejects the eleventh party member', () => {
  const { parties, close } = fixture();
  try {
    const party = create(parties);
    addMembers(parties, party.id, 1, 9);
    assert.throws(() => parties.joinParty(party.id, 'member-10'), /penuh atau sudah tidak mencari anggota/);
    assert.equal(parties.getParty(party.id).member_count, 10);
  } finally { close(); }
});

test('full party returns to recruiting when a member leaves', () => {
  const { parties, close } = fixture();
  try {
    const party = create(parties);
    addMembers(parties, party.id, 1, 9);
    parties.leaveParty(party.id, 'member-9');
    assert.equal(parties.getParty(party.id).status, 'RECRUITING');
  } finally { close(); }
});

test('public-list join rejects private parties', () => {
  const { parties, close } = fixture();
  try {
    const party = create(parties, 'leader', { visibility: 'PRIVATE' });
    assert.throws(() => parties.joinParty(party.id, 'joiner', { requirePublic: true }), /bukan party umum/);
  } finally { close(); }
});

test('private party can be joined using a valid code', () => {
  const { parties, close } = fixture();
  try {
    const party = create(parties, 'leader', { visibility: 'PRIVATE' });
    assert.equal(parties.joinByCode(party.code, 'joiner').member_count, 2);
  } finally { close(); }
});

test('rejects invalid party codes', () => {
  const { parties, close } = fixture();
  try {
    assert.throws(() => parties.joinByCode('XXXXX', 'joiner'), /tidak valid atau sudah kedaluwarsa/);
  } finally { close(); }
});

test('rejects joins to full parties', () => {
  const { parties, close } = fixture();
  try {
    const party = create(parties);
    addMembers(parties, party.id, 1, 9);
    assert.throws(() => parties.joinByCode(party.code, 'late-member'), /penuh atau sudah tidak mencari anggota/);
  } finally { close(); }
});

test('transfers leadership and updates member roles atomically', () => {
  const { parties, close } = fixture();
  try {
    const party = create(parties);
    parties.joinParty(party.id, 'new-leader');
    const transferred = parties.transferLeader(party.id, 'leader', 'new-leader');
    assert.equal(transferred.leader_id, 'new-leader');
    assert.equal(transferred.members.find((member) => member.user_id === 'new-leader').member_role, 'LEADER');
    assert.equal(transferred.members.find((member) => member.user_id === 'leader').member_role, 'MEMBER');
  } finally { close(); }
});

test('leader leaving transfers leadership to the earliest joined member', () => {
  const { parties, close } = fixture();
  try {
    const party = create(parties);
    parties.joinParty(party.id, 'first');
    parties.joinParty(party.id, 'second');
    const result = parties.leaveParty(party.id, 'leader');
    assert.equal(result.party.leader_id, 'first');
    assert.equal(result.party.members.find((member) => member.user_id === 'first').member_role, 'LEADER');
  } finally { close(); }
});

test('closing a party blocks joins and removes records after cleanup', () => {
  const { db, parties, close } = fixture();
  try {
    const party = create(parties);
    parties.beginClose(party.id, 'leader');
    assert.throws(() => parties.joinParty(party.id, 'joiner'), /sudah tidak tersedia/);
    assert.equal(parties.cleanupTasks().length, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM party_members').get().count, 0);
    parties.completeClose(party.id);
    assert.equal(parties.getParty(party.id), null);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM party_members').get().count, 0);
    assert.equal(parties.cleanupTasks().length, 0);
  } finally { close(); }
});

test('last member leaving invalidates the party and queues lobby cleanup', () => {
  const { parties, close } = fixture();
  try {
    const party = create(parties);
    const result = parties.leaveParty(party.id, 'leader');
    assert.equal(result.closed, true);
    assert.equal(parties.getParty(party.id), null);
    assert.equal(parties.cleanupTasks()[0].party_id, party.id);
    assert.throws(() => parties.joinByCode(party.code, 'new-user'), /tidak valid atau sudah kedaluwarsa/);
  } finally { close(); }
});

test('leaving removes lobby access for the departed user', () => {
  const { parties, close } = fixture();
  try {
    const party = create(parties);
    parties.joinParty(party.id, 'departing');
    parties.leaveParty(party.id, 'departing');
    const guild = { roles: { everyone: { id: 'everyone' }, cache: new Map([['staff', {}]]) } };
    const overwrites = lobbyOverwrites(guild, 'bot', ['staff'], parties.getParty(party.id).members.map((m) => m.user_id));
    assert.equal(overwrites.some((overwrite) => overwrite.id === 'departing'), false);
  } finally { close(); }
});

test('party membership and lobby records survive reopening the database', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-party-'));
  const databasePath = path.join(directory, 'party.sqlite');
  try {
    const first = fixture(databasePath);
    const party = create(first.parties);
    first.parties.setLobby(party.id, 'channel-id', 'message-id');
    first.close();
    const second = fixture(databasePath);
    try {
      const restored = second.parties.getParty(party.id);
      assert.equal(restored.lobby_channel_id, 'channel-id');
      assert.equal(restored.lobby_message_id, 'message-id');
      assert.equal(restored.members[0].user_id, 'leader');
    } finally { second.close(); }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('database migration adds persistent activity tracking to an existing installation', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-party-migration-'));
  const databasePath = path.join(directory, 'party.sqlite');
  try {
    const oldDb = new Database(databasePath);
    const partyId = 'legacy-party';
    try {
      oldDb.exec(readFileSync(new URL('../src/database/schema.sql', import.meta.url), 'utf8'));
      oldDb.prepare('INSERT INTO schema_migrations(version) VALUES (1)').run();
      oldDb.transaction(() => {
        oldDb.prepare(`
          INSERT INTO parties
            (id, code, leader_id, name, type, tier, visibility, status)
          VALUES (?, ?, ?, ?, 'HOST', 10, 'PUBLIC', 'RECRUITING')
        `).run(partyId, 'ABC23', 'leader', 'Legacy party');
        oldDb.prepare(`
          INSERT INTO party_members(party_id, user_id, member_role)
          VALUES (?, ?, 'LEADER')
        `).run(partyId, 'leader');
      })();
    } finally {
      oldDb.close();
    }

    const migrated = openDatabase(databasePath);
    try {
      const restored = new PartyService(migrated).getParty(partyId);
      assert.ok(restored.last_activity_at);
      assert.ok(migrated.prepare('SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?')
        .get('index', 'idx_parties_idle'));
    } finally {
      migrated.pragma('wal_checkpoint(TRUNCATE)');
      migrated.close();
    }
  } finally {
    fs.rmSync(databasePath, { force: true, maxRetries: 20, retryDelay: 100 });
    fs.rmSync(`${databasePath}-wal`, { force: true, maxRetries: 20, retryDelay: 100 });
    fs.rmSync(`${databasePath}-shm`, { force: true, maxRetries: 20, retryDelay: 100 });
    fs.rmdirSync(directory);
  }
});

test('lobby messages refresh activity, while bot messages do not', () => {
  const { db, parties, close } = fixture();
  try {
    const party = create(parties);
    parties.setLobby(party.id, 'lobby-channel');
    db.prepare("UPDATE parties SET last_activity_at = datetime('now', '-31 minutes') WHERE id = ?")
      .run(party.id);
    const listeners = new Map();
    const service = new InactivityService(
      { on: (event, listener) => listeners.set(event, listener) },
      parties,
      {},
      {},
      { guildId: 'guild' },
      { error() {}, info() {}, debug() {} },
    );
    service.register();
    const onMessage = listeners.get('messageCreate');
    onMessage({ guildId: 'guild', author: { bot: true }, channelId: 'lobby-channel' });
    assert.deepEqual(parties.idlePartyIds(30), [party.id]);
    onMessage({ guildId: 'guild', author: { bot: false }, channelId: 'other-channel' });
    assert.deepEqual(parties.idlePartyIds(30), [party.id]);
    parties.idlePartyIds(30);
    onMessage({ guildId: 'guild', author: { bot: false }, channelId: 'lobby-channel' });
    assert.equal(parties.closeIdleParty(party.id, 30), null);
    assert.deepEqual(parties.idlePartyIds(30), []);
  } finally { close(); }
});

test('idle parties are closed and cleaned up after thirty minutes without lobby chat', async () => {
  const { db, parties, close } = fixture();
  try {
    const party = create(parties);
    parties.setLobby(party.id, 'lobby-channel');
    db.prepare("UPDATE parties SET last_activity_at = datetime('now', '-31 minutes') WHERE id = ?")
      .run(party.id);
    const deletedChannels = [];
    const notifications = [];
    const logs = [];
    const client = {
      database: db,
      users: {
        fetch: async (userId) => ({
          send: async (message) => notifications.push({ userId, message }),
        }),
      },
    };
    const recovery = new RecoveryService(
      client,
      parties,
      { deleteLobby: async (channelId) => deletedChannels.push(channelId) },
      { refresh: async () => logs.push('list-refreshed') },
      { guildId: 'guild' },
      { info: (message) => logs.push(message), warn() {}, error() {} },
    );
    const inactivity = new InactivityService(
      client,
      parties,
      recovery,
      { refresh: async () => logs.push('list-refreshed') },
      { guildId: 'guild' },
      { info: (message) => logs.push(message), debug() {}, error() {} },
    );

    assert.equal(await inactivity.sweep(), 1);
    assert.equal(parties.getParty(party.id), null);
    assert.deepEqual(deletedChannels, ['lobby-channel']);
    assert.equal(parties.cleanupTasks().length, 0);
    assert.equal(notifications.length, 1);
    assert.match(notifications[0].message.content, /30 menit/);
    assert.ok(logs.includes('list-refreshed'));
  } finally { close(); }
});

test('startup recovery rebuilds active lobbies and refreshes the party list', async () => {
  const { db, parties, close } = fixture();
  try {
    const party = create(parties);
    const calls = [];
    const recovery = new RecoveryService(
      { database: db },
      parties,
      { ensureLobby: async (_guild, recovered) => calls.push(recovered.id), deleteLobby: async () => {} },
      { refresh: async (guildId) => calls.push(guildId) },
      { guildId: 'guild' },
      { info() {}, warn() {}, error() {} },
    );
    await recovery.recover({ id: 'guild' });
    assert.deepEqual(calls, [party.id, 'guild']);
  } finally { close(); }
});

test('simultaneous joins do not exceed ten members', async () => {
  const { parties, close } = fixture();
  try {
    const party = create(parties);
    addMembers(parties, party.id, 1, 7);
    const results = await Promise.allSettled(['racer-1', 'racer-2', 'racer-3'].map((userId) =>
      Promise.resolve().then(() => parties.joinParty(party.id, userId)),
    ));
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 2);
    assert.equal(parties.getParty(party.id).member_count, 10);
    assert.equal(parties.getParty(party.id).status, 'FULL');
  } finally { close(); }
});

test('a user cannot be a member of multiple parties at the database layer', () => {
  const { db, parties, close } = fixture();
  try {
    const first = create(parties, 'leader-1');
    const second = create(parties, 'leader-2');
    parties.joinParty(first.id, 'shared');
    assert.throws(() => db.prepare(`
      INSERT INTO party_members(party_id, user_id, member_role) VALUES (?, ?, 'MEMBER')
    `).run(second.id, 'shared'), /UNIQUE constraint failed/);
  } finally { close(); }
});

test('private parties never appear in public results', () => {
  const { parties, close } = fixture();
  try {
    const visible = create(parties, 'public-leader');
    const hidden = create(parties, 'private-leader', { visibility: 'PRIVATE' });
    assert.deepEqual(parties.publicParties().map((party) => party.id), [visible.id]);
    assert.equal(parties.publicParties().some((party) => party.id === hidden.id), false);
  } finally { close(); }
});

test('party codes use cryptographic uppercase characters without ambiguous symbols', () => {
  const codes = new Set(Array.from({ length: 100 }, () => generatePartyCode()));
  assert.equal(codes.size, 100);
  assert.ok([...codes].every((code) => /^[A-HJ-NP-Z2-9]{5}$/.test(code)));
});

test('SQLite enforces one leader row per party and a valid leader membership', () => {
  const { db, parties, close } = fixture();
  try {
    const party = create(parties);
    assert.throws(() => db.prepare(`
      INSERT INTO party_members(party_id, user_id, member_role) VALUES (?, ?, 'LEADER')
    `).run(party.id, 'extra-leader'), /UNIQUE constraint failed/);
    assert.throws(() => db.prepare(`
      UPDATE parties SET leader_id = ? WHERE id = ?
    `).run('not-a-member', party.id), /FOREIGN KEY constraint failed/);
  } finally { close(); }
});

test('panel, party list, lobby, and modals display Indonesian text', () => {
  const panel = createPanel();
  const list = buildPartyList([], 0, 10);
  const lobby = buildPartyLobby({
    name: 'Uji Party',
    description: '',
    code: 'ABCDE',
    type: 'HOST',
    tier: 3,
    visibility: 'PUBLIC',
    status: 'RECRUITING',
    leader_id: 'pemimpin',
    member_count: 1,
    max_members: 10,
    members: [{ user_id: 'pemimpin', member_role: 'LEADER' }],
  });
  const createModal = createPartyModal().toJSON();
  const joinModal = joinCodeModal().toJSON();

  assert.equal(panel.embeds[0].data.title, 'THE FORGE | PARTY MANAGER');
  assert.match(panel.embeds[0].data.description, /Bentuk party, temukan teman bermain/);
  assert.match(panel.embeds[0].data.description, /PERHATIAN/);
  assert.match(panel.embeds[0].data.description, /30 menit/);
  assert.match(panel.embeds[0].data.description, /Find Your Party\. Forge Your Journey\./);
  assert.equal(panel.components[0].components[0].data.label, 'BUAT PARTY');
  assert.match(list.embeds[0].data.description, /Belum ada party umum/);
  assert.equal(list.components.at(-1).components[0].data.label, 'SEBELUMNYA');
  assert.match(lobby.embeds[0].data.description, /Leader:/);
  assert.match(lobby.embeds[0].data.description, /Jenis Party:\*\* HOST/);
  assert.match(lobby.embeds[0].data.description, /MENCARI ANGGOTA/);
  assert.equal(createModal.title, 'Buat Party The Forge');
  assert.equal(createModal.components[0].label, 'JENIS PARTY');
  assert.equal(createModal.components[0].component.options[0].label, 'HOST');
  assert.equal(joinModal.title, 'Gabung dengan Kode Party');
});

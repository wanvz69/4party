import { generatePartyCode, generatePartyId } from '../utils/partyCode.js';
import { normalizePartyCode, validatePartyInput } from '../utils/validation.js';
import { UserFacingError } from '../utils/errors.js';

export class PartyService {
  constructor(db, maxMembers = 10) {
    this.db = db;
    this.maxMembers = maxMembers;
  }

  getParty(id) {
    const party = this.db.prepare('SELECT * FROM parties WHERE id = ?').get(id);
    return party ? this.#withMembers(party) : null;
  }

  getByCode(code) {
    const party = this.db.prepare('SELECT * FROM parties WHERE code = ?').get(normalizePartyCode(code));
    return party ? this.#withMembers(party) : null;
  }

  getUserParty(userId) {
    const row = this.db.prepare(`
      SELECT p.* FROM parties p
      JOIN party_members m ON m.party_id = p.id
      WHERE m.user_id = ? AND p.status != 'CLOSED'
    `).get(userId);
    return row ? this.#withMembers(row) : null;
  }

  createParty(leaderId, rawInput) {
    const input = validatePartyInput(rawInput);
    const create = this.db.transaction(() => {
      if (this.db.prepare('SELECT 1 FROM party_members WHERE user_id = ?').get(leaderId)) {
        throw new UserFacingError('Kamu sudah menjadi pemilik atau anggota party aktif.');
      }
      let id;
      let code;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        id = generatePartyId();
        code = generatePartyCode();
        if (!this.db.prepare('SELECT 1 FROM parties WHERE id = ? OR code = ?').get(id, code)) break;
        id = undefined;
      }
      if (!id) throw new UserFacingError('ID party unik tidak dapat dibuat. Silakan coba lagi.');
      this.db.prepare(`
        INSERT INTO parties
          (id, code, leader_id, name, description, type, tier, visibility, status, max_members, last_activity_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'RECRUITING', ?, datetime('now'))
      `).run(id, code, leaderId, input.name, input.description, input.type, input.tier, input.visibility, this.maxMembers);
      this.db.prepare(`
        INSERT INTO party_members(party_id, user_id, member_role) VALUES (?, ?, 'LEADER')
      `).run(id, leaderId);
      return id;
    });
    return this.getParty(create.immediate());
  }

  setLobby(id, channelId, messageId = null) {
    this.db.prepare(`
      UPDATE parties SET lobby_channel_id = ?, lobby_message_id = ?, updated_at = datetime('now')
      WHERE id = ? AND status != 'CLOSED'
    `).run(channelId, messageId, id);
  }

  setLobbyMessage(id, messageId) {
    this.db.prepare('UPDATE parties SET lobby_message_id = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(messageId, id);
  }

  recordLobbyActivity(channelId) {
    return this.db.prepare(`
      UPDATE parties
      SET last_activity_at = datetime('now'), updated_at = datetime('now')
      WHERE lobby_channel_id = ? AND status != 'CLOSED'
    `).run(channelId).changes > 0;
  }

  idlePartyIds(idleMinutes) {
    return this.db.prepare(`
      SELECT id FROM parties
      WHERE status != 'CLOSED'
        AND datetime(last_activity_at) <= datetime('now', ?)
      ORDER BY last_activity_at
    `).all(`-${idleMinutes} minutes`).map(({ id }) => id);
  }

  closeIdleParty(partyId, idleMinutes) {
    const close = this.db.transaction(() => {
      const party = this.db.prepare(`
        SELECT * FROM parties
        WHERE id = ? AND status != 'CLOSED'
          AND datetime(last_activity_at) <= datetime('now', ?)
      `).get(partyId, `-${idleMinutes} minutes`);
      if (!party) return null;
      const snapshot = this.#withMembers(party);
      this.#markClosing(party);
      this.db.prepare('DELETE FROM parties WHERE id = ?').run(partyId);
      return snapshot;
    });
    return close.immediate();
  }

  joinParty(partyId, userId, { requirePublic = false, invitedBy = null } = {}) {
    const join = this.db.transaction(() => {
      const party = this.db.prepare('SELECT * FROM parties WHERE id = ?').get(partyId);
      if (!party || party.status === 'CLOSED') throw new UserFacingError('Party ini sudah tidak tersedia.');
      if (requirePublic && party.visibility !== 'PUBLIC') throw new UserFacingError('Party ini bukan party umum.');
      if (party.status !== 'RECRUITING') throw new UserFacingError('Party ini penuh atau sudah tidak mencari anggota.');
      if (this.db.prepare('SELECT 1 FROM party_members WHERE user_id = ?').get(userId)) {
        throw new UserFacingError('Kamu sudah menjadi anggota party aktif.');
      }
      if (invitedBy && !this.db.prepare('SELECT 1 FROM party_members WHERE party_id = ? AND user_id = ?')
        .get(partyId, invitedBy)) {
        throw new UserFacingError('Hanya anggota party saat ini yang dapat mengundang orang lain.');
      }
      const count = this.db.prepare('SELECT COUNT(*) AS count FROM party_members WHERE party_id = ?').get(partyId).count;
      if (count >= party.max_members) {
        throw new UserFacingError('Party ini sudah penuh.');
      }
      this.db.prepare("INSERT INTO party_members(party_id, user_id, member_role) VALUES (?, ?, 'MEMBER')")
        .run(partyId, userId);
      const newCount = count + 1;
      const status = newCount >= party.max_members ? 'FULL' : 'RECRUITING';
      this.db.prepare("UPDATE parties SET status = ?, updated_at = datetime('now') WHERE id = ?")
        .run(status, partyId);
    });
    join.immediate();
    return this.getParty(partyId);
  }

  joinByCode(code, userId) {
    const party = this.getByCode(code);
    if (!party) throw new UserFacingError('Kode Party tidak valid atau sudah kedaluwarsa.');
    return this.joinParty(party.id, userId);
  }

  inviteMember(partyId, inviterId, invitedId) {
    if (inviterId === invitedId) throw new UserFacingError('Kamu tidak dapat mengundang diri sendiri.');
    return this.joinParty(partyId, invitedId, { invitedBy: inviterId });
  }

  leaveParty(partyId, userId) {
    const leave = this.db.transaction(() => {
      const party = this.db.prepare('SELECT * FROM parties WHERE id = ?').get(partyId);
      if (!party || party.status === 'CLOSED') throw new UserFacingError('Party ini sudah tidak aktif.');
      const member = this.db.prepare('SELECT * FROM party_members WHERE party_id = ? AND user_id = ?')
        .get(partyId, userId);
      if (!member) throw new UserFacingError('Kamu bukan anggota party ini.');
      this.db.prepare('DELETE FROM party_members WHERE party_id = ? AND user_id = ?').run(partyId, userId);
      const remaining = this.db.prepare(`
        SELECT user_id FROM party_members WHERE party_id = ? ORDER BY joined_at, id
      `).all(partyId);
      if (!remaining.length) {
        this.#markClosing(party);
        this.db.prepare('DELETE FROM parties WHERE id = ?').run(partyId);
        return { closed: true, party: { ...party, members: [] } };
      }
      let newLeaderId = party.leader_id;
      if (party.leader_id === userId) {
        newLeaderId = remaining[0].user_id;
        this.db.prepare("UPDATE party_members SET member_role = 'MEMBER' WHERE party_id = ?")
          .run(partyId);
        this.db.prepare("UPDATE party_members SET member_role = 'LEADER' WHERE party_id = ? AND user_id = ?")
          .run(partyId, newLeaderId);
      }
      const count = remaining.length;
      this.db.prepare(`
        UPDATE parties SET leader_id = ?, status = ?, updated_at = datetime('now') WHERE id = ?
      `).run(newLeaderId, count >= party.max_members ? 'FULL' : 'RECRUITING', partyId);
      return { closed: false, partyId };
    });
    const result = leave.immediate();
    return result.closed ? result : { ...result, party: this.getParty(result.partyId) };
  }

  kickMember(partyId, leaderId, targetId) {
    const result = this.db.transaction(() => {
      const party = this.db.prepare("SELECT * FROM parties WHERE id = ? AND status != 'CLOSED'").get(partyId);
      if (!party || party.leader_id !== leaderId) throw new UserFacingError('Hanya host party saat ini yang dapat mengeluarkan anggota.');
      if (targetId === leaderId) throw new UserFacingError('Host tidak dapat mengeluarkan dirinya sendiri.');
      const removed = this.db.prepare('DELETE FROM party_members WHERE party_id = ? AND user_id = ?')
        .run(partyId, targetId);
      if (!removed.changes) throw new UserFacingError('Pengguna tersebut bukan anggota party ini.');
      const count = this.db.prepare('SELECT COUNT(*) AS count FROM party_members WHERE party_id = ?').get(partyId).count;
      this.db.prepare("UPDATE parties SET status = ?, updated_at = datetime('now') WHERE id = ?")
        .run(count >= party.max_members ? 'FULL' : 'RECRUITING', partyId);
    });
    result.immediate();
    return this.getParty(partyId);
  }

  transferLeader(partyId, leaderId, targetId) {
    const transfer = this.db.transaction(() => {
      const party = this.db.prepare("SELECT * FROM parties WHERE id = ? AND status != 'CLOSED'").get(partyId);
      if (!party || party.leader_id !== leaderId) throw new UserFacingError('Hanya host party saat ini yang dapat memindahkan posisi host.');
      if (!this.db.prepare('SELECT 1 FROM party_members WHERE party_id = ? AND user_id = ?').get(partyId, targetId)) {
        throw new UserFacingError('Pengguna yang dipilih bukan anggota party ini.');
      }
      if (targetId === leaderId) throw new UserFacingError('Kamu sudah menjadi host party.');
      this.db.prepare("UPDATE party_members SET member_role = 'MEMBER' WHERE party_id = ?").run(partyId);
      this.db.prepare("UPDATE party_members SET member_role = 'LEADER' WHERE party_id = ? AND user_id = ?")
        .run(partyId, targetId);
      this.db.prepare("UPDATE parties SET leader_id = ?, updated_at = datetime('now') WHERE id = ?")
        .run(targetId, partyId);
    });
    transfer.immediate();
    return this.getParty(partyId);
  }

  beginClose(partyId, leaderId) {
    const begin = this.db.transaction(() => {
      const party = this.db.prepare('SELECT * FROM parties WHERE id = ?').get(partyId);
      if (!party || party.status === 'CLOSED') throw new UserFacingError('Party ini sudah ditutup.');
      if (party.leader_id !== leaderId) throw new UserFacingError('Hanya host party saat ini yang dapat menutup party.');
      this.#markClosing(party);
      const snapshot = this.#withMembers(party);
      this.db.prepare('DELETE FROM parties WHERE id = ?').run(partyId);
      return snapshot;
    });
    return begin.immediate();
  }

  #markClosing(party) {
    this.db.prepare("UPDATE parties SET status = 'CLOSED', updated_at = datetime('now') WHERE id = ?")
      .run(party.id);
    this.db.prepare(`
      INSERT INTO cleanup_tasks(party_id, lobby_channel_id)
      VALUES (?, ?)
    `).run(party.id, party.lobby_channel_id);
  }

  completeClose(partyId) {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM parties WHERE id = ?').run(partyId);
      this.db.prepare('DELETE FROM cleanup_tasks WHERE party_id = ?').run(partyId);
    }).immediate();
  }

  recordCleanupFailure(taskId, error) {
    this.db.prepare(`
      UPDATE cleanup_tasks
      SET attempts = attempts + 1, last_error = ?
      WHERE id = ?
    `).run(String(error).slice(0, 500), taskId);
  }

  cleanupTasks() {
    return this.db.prepare('SELECT * FROM cleanup_tasks ORDER BY id').all();
  }

  publicParties() {
    return this.db.prepare(`
      SELECT * FROM parties
      WHERE visibility = 'PUBLIC' AND status = 'RECRUITING'
      ORDER BY created_at DESC, id
    `).all().map((party) => this.#withMembers(party));
  }

  #withMembers(party) {
    const members = this.db.prepare(`
      SELECT user_id, joined_at, member_role FROM party_members
      WHERE party_id = ? ORDER BY joined_at, id
    `).all(party.id);
    return { ...party, members, member_count: members.length };
  }
}

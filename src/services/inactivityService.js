import { Events } from 'discord.js';

const SWEEP_INTERVAL_MS = 30_000;

export class InactivityService {
  constructor(client, partyService, recoveryService, partyListService, config, logger, idleMinutes = 30) {
    this.client = client;
    this.partyService = partyService;
    this.recoveryService = recoveryService;
    this.partyListService = partyListService;
    this.config = config;
    this.logger = logger;
    this.idleMinutes = idleMinutes;
    this.running = false;
    this.refreshPending = false;
  }

  register() {
    this.client.on(Events.MessageCreate, (message) => {
      if (
        message.guildId !== this.config.guildId
        || message.author?.bot
        || message.webhookId
      ) return;
      try {
        this.partyService.recordLobbyActivity(message.channelId);
      } catch (error) {
        this.logger.error('Aktivitas obrolan lobi gagal disimpan.', {
          channelId: message.channelId,
          error: error.message,
        });
      }
    });
  }

  start() {
    if (this.timer) return this.timer;
    const timer = setInterval(() => {
      this.sweep().catch((error) => {
        this.logger.error('Pemeriksaan party tidak aktif gagal.', { error: error.stack ?? error.message });
      });
    }, SWEEP_INTERVAL_MS);
    timer.unref();
    this.timer = timer;
    return timer;
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  async sweep() {
    if (this.running) return 0;
    this.running = true;
    try {
      let closedCount = 0;
      for (const partyId of this.partyService.idlePartyIds(this.idleMinutes)) {
        const closedParty = this.partyService.closeIdleParty(partyId, this.idleMinutes);
        if (!closedParty) continue;
        closedCount += 1;
        this.refreshPending = true;
        this.logger.info('Party ditutup karena tidak ada obrolan selama batas waktu.', {
          partyId,
          idleMinutes: this.idleMinutes,
        });
        await this.#notifyMembers(closedParty);
      }

      await this.recoveryService.processCleanupTasks();
      if (this.refreshPending) {
        await this.partyListService.refresh(this.config.guildId);
        this.refreshPending = false;
      }
      return closedCount;
    } finally {
      this.running = false;
    }
  }

  async #notifyMembers(party) {
    await Promise.all(party.members.map(async (member) => {
      try {
        const user = await this.client.users.fetch(member.user_id);
        await user.send({
          content: `Party **${party.name}** ditutup otomatis karena tidak ada obrolan di lobi selama ${this.idleMinutes} menit.`,
          allowedMentions: { parse: [] },
        });
      } catch (error) {
        this.logger.debug('Notifikasi penutupan party tidak dapat dikirim melalui pesan pribadi.', {
          partyId: party.id,
          userId: member.user_id,
          error: error.message,
        });
      }
    }));
  }
}

export class RecoveryService {
  constructor(client, partyService, lobbyService, partyListService, config, logger) {
    this.client = client;
    this.partyService = partyService;
    this.lobbyService = lobbyService;
    this.partyListService = partyListService;
    this.config = config;
    this.logger = logger;
  }

  async recover(guild) {
    await this.processCleanupTasks();
    const parties = this.client.database.prepare("SELECT id FROM parties WHERE status != 'CLOSED' ORDER BY created_at").all();
    for (const { id } of parties) {
      try {
        const party = this.partyService.getParty(id);
        if (party) await this.lobbyService.ensureLobby(guild, party);
      } catch (error) {
        this.logger.error('Lobi party gagal dipulihkan; party akan ditutup dengan aman.', { partyId: id, error: error.message });
        const party = this.partyService.getParty(id);
        if (party) {
          try {
            this.partyService.beginClose(id, party.leader_id);
            await this.processCleanupTasks();
          } catch (cleanupError) {
            this.logger.error('Party yang gagal dipulihkan tidak dapat ditutup.', { partyId: id, error: cleanupError.message });
          }
        }
      }
    }
    await this.partyListService.refresh(guild.id);
  }

  async processCleanupTasks() {
    for (const task of this.partyService.cleanupTasks()) {
      try {
        await this.lobbyService.deleteLobby(task.lobby_channel_id);
        this.partyService.completeClose(task.party_id);
      } catch (error) {
        this.partyService.recordCleanupFailure(task.id, error.message);
        this.logger.warn('Pembersihan lobi party tertunda dan akan dicoba kembali.', {
          partyId: task.party_id,
          attempts: task.attempts + 1,
          error: error.message,
        });
      }
    }
  }
}

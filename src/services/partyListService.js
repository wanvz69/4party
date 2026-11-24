import { buildPartyList } from '../embeds/partyList.js';
import {
  fetchOrNull,
  findBotComponentMessage,
  isUnknownChannel,
  isUnknownMessage,
} from '../utils/discord.js';

export class PartyListService {
  constructor(client, partyService, config, logger) {
    this.client = client;
    this.partyService = partyService;
    this.config = config;
    this.logger = logger;
  }

  async refresh(guildId = this.config.guildId, page) {
    const settings = this.client.database.prepare('SELECT * FROM bot_config WHERE guild_id = ?').get(guildId);
    if (!settings?.party_list_channel_id) return;
    const guild = await this.client.guilds.fetch(guildId);
    const channel = await fetchOrNull(
      () => guild.channels.fetch(settings.party_list_channel_id),
      isUnknownChannel,
    );
    if (!channel?.isTextBased()) throw new Error('Kanal daftar party yang dikonfigurasi tidak ditemukan atau bukan kanal teks.');

    const parties = this.partyService.publicParties();
    const persistedPage = page ?? settings.party_list_page ?? 0;
    const payload = buildPartyList(parties, persistedPage, this.config.partiesPerPage);
    let message = settings.party_list_message_id
      ? await fetchOrNull(() => channel.messages.fetch(settings.party_list_message_id), isUnknownMessage)
      : null;
    if (!message) {
      message = await findBotComponentMessage(channel, this.client.user.id, 'partylist:refresh');
    }
    if (!message) {
      message = await channel.send(payload);
      this.client.database.prepare(`
        UPDATE bot_config SET party_list_message_id = ?, party_list_page = ?, updated_at = datetime('now')
        WHERE guild_id = ?
      `).run(message.id, payload.page, guildId);
    } else {
      await message.edit(payload);
      this.client.database.prepare(`
        UPDATE bot_config
        SET party_list_message_id = ?, party_list_page = ?, updated_at = datetime('now')
        WHERE guild_id = ?
      `).run(message.id, payload.page, guildId);
    }
    return { message, page: payload.page };
  }
}

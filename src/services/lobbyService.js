import { ChannelType } from 'discord.js';
import { buildPartyLobby } from '../embeds/partyLobby.js';
import { lobbyOverwrites } from './permissionService.js';
import {
  fetchOrNull,
  findBotComponentMessage,
  isUnknownChannel,
  isUnknownMessage,
} from '../utils/discord.js';

export class LobbyService {
  constructor(client, partyService, config, logger) {
    this.client = client;
    this.partyService = partyService;
    this.config = config;
    this.logger = logger;
  }

  async ensureLobby(guild, party) {
    const settings = this.#guildConfig(guild.id);
    if (!settings?.party_lobby_category_id) throw new Error('Kategori lobi party belum dikonfigurasi. Jalankan /setup.');
    let channel = party.lobby_channel_id
      ? await fetchOrNull(() => guild.channels.fetch(party.lobby_channel_id), isUnknownChannel)
      : null;
    if (!channel) {
      channel = guild.channels.cache.find((candidate) =>
        candidate.type === ChannelType.GuildText
        && candidate.parentId === settings.party_lobby_category_id
        && [`lobi-${party.code.toLowerCase()}`, `party-${party.code.toLowerCase()}`].includes(candidate.name),
      ) ?? null;
    }
    if (channel && channel.type !== ChannelType.GuildText) channel = null;
    if (!channel) {
      channel = await guild.channels.create({
        name: `lobi-${party.code.toLowerCase()}`,
        type: ChannelType.GuildText,
        parent: settings.party_lobby_category_id,
        topic: `Lobi khusus party • ${party.id}`,
        permissionOverwrites: lobbyOverwrites(
          guild,
          this.client.user.id,
          this.#roleIds(guild.id),
          party.members.map((member) => member.user_id),
        ),
      });
      this.partyService.setLobby(party.id, channel.id);
      party = this.partyService.getParty(party.id);
    } else {
      if (channel.name !== `lobi-${party.code.toLowerCase()}`) {
        await channel.setName(`lobi-${party.code.toLowerCase()}`);
      }
      if (party.lobby_channel_id !== channel.id) {
        this.partyService.setLobby(party.id, channel.id);
        party = this.partyService.getParty(party.id);
      }
      await channel.permissionOverwrites.set(lobbyOverwrites(
        guild,
        this.client.user.id,
        this.#roleIds(guild.id),
        party.members.map((member) => member.user_id),
      ));
      if (channel.parentId !== settings.party_lobby_category_id) {
        await channel.setParent(settings.party_lobby_category_id, { lockPermissions: false });
      }
    }
    return this.updateLobby(party.id, channel);
  }

  async updateLobby(partyId, channelOverride = null) {
    const party = this.partyService.getParty(partyId);
    if (!party || party.status === 'CLOSED') return null;
    const guild = await this.client.guilds.fetch(this.config.guildId);
    const channel = channelOverride ?? (party.lobby_channel_id
      ? await fetchOrNull(() => guild.channels.fetch(party.lobby_channel_id), isUnknownChannel)
      : null);
    if (!channel) return this.ensureLobby(guild, party);
    await channel.permissionOverwrites.set(lobbyOverwrites(
      guild,
      this.client.user.id,
      this.#roleIds(guild.id),
      party.members.map((member) => member.user_id),
    ));

    let message = party.lobby_message_id
      ? await fetchOrNull(() => channel.messages.fetch(party.lobby_message_id), isUnknownMessage)
      : null;
    if (!message) {
      message = await findBotComponentMessage(channel, this.client.user.id, `party:refresh:${party.id}`);
    }
    const payload = buildPartyLobby(party);
    if (message) {
      await message.edit(payload);
      if (party.lobby_message_id !== message.id) this.partyService.setLobbyMessage(party.id, message.id);
    } else {
      message = await channel.send(payload);
      this.partyService.setLobbyMessage(party.id, message.id);
    }
    return channel;
  }

  async deleteLobby(channelId) {
    if (!channelId) return;
    const channel = await fetchOrNull(() => this.client.channels.fetch(channelId), isUnknownChannel);
    if (channel) {
      await channel.permissionOverwrites.set(lobbyOverwrites(
        channel.guild,
        this.client.user.id,
        this.#roleIds(channel.guild.id),
        [],
      ));
      try {
        await channel.delete('Party telah ditutup');
      } catch (error) {
        if (!isUnknownChannel(error)) throw error;
      }
    }
  }

  #guildConfig(guildId) {
    return this.client.database.prepare('SELECT * FROM bot_config WHERE guild_id = ?').get(guildId);
  }

  #roleIds(guildId) {
    const stored = this.#guildConfig(guildId)?.lobby_view_role_ids;
    let roleIds = [];
    try {
      roleIds = stored ? JSON.parse(stored) : this.config.lobbyViewRoleIds;
    } catch (error) {
      this.logger.error('Konfigurasi peran lobi tersimpan bukan JSON yang valid.', { guildId, error: error.message });
      roleIds = this.config.lobbyViewRoleIds;
    }
    return roleIds.filter((roleId) => this.client.guilds.cache.get(guildId)?.roles.cache.has(roleId));
  }
}

import {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { createPanel } from '../embeds/createPanel.js';
import {
  fetchOrNull,
  findBotComponentMessage,
  isUnknownChannel,
  isUnknownMessage,
} from '../utils/discord.js';

export const setupCommand = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Buat atau perbaiki kategori, kanal, dan panel party The Forge.')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false);

function findCategory(guild, name, storedId) {
  const stored = storedId ? guild.channels.cache.get(storedId) : null;
  return stored?.type === ChannelType.GuildCategory
    ? stored
    : guild.channels.cache.find((channel) => channel.type === ChannelType.GuildCategory && channel.name === name);
}

async function ensureCategory(guild, name, storedId, oldNames = []) {
  const category = findCategory(guild, name, storedId)
    ?? oldNames.map((oldName) => guild.channels.cache.find((channel) =>
      channel.type === ChannelType.GuildCategory && channel.name === oldName,
    )).find(Boolean)
    ?? await guild.channels.create({ name, type: ChannelType.GuildCategory });
  if (category.name !== name) await category.setName(name);
  return category;
}

async function ensureTextChannel(guild, category, name, storedId, oldNames = []) {
  const stored = storedId
    ? await fetchOrNull(() => guild.channels.fetch(storedId), isUnknownChannel)
    : null;
  if (stored?.type === ChannelType.GuildText && stored.parentId === category.id) {
    if (stored.name !== name) await stored.setName(name);
    return stored;
  }
  const existing = guild.channels.cache.find((channel) =>
    channel.type === ChannelType.GuildText
    && channel.parentId === category.id
    && [name, ...oldNames].includes(channel.name),
  );
  if (existing) {
    if (existing.name !== name) await existing.setName(name);
    return existing;
  }
  return guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: category.id,
  });
}

async function ensurePanel(channel, messageId, payload, marker) {
  let existing = messageId
    ? await fetchOrNull(() => channel.messages.fetch(messageId), isUnknownMessage)
    : null;
  if (!existing && marker) existing = await findBotComponentMessage(channel, channel.client.user.id, marker);
  if (existing) {
    await existing.edit(payload);
    return existing;
  }
  return channel.send(payload);
}

export async function ensureServerStructure(client, guild, config, logger) {
  await guild.channels.fetch();
  await guild.roles.fetch();
  const db = client.database;
  const old = db.prepare('SELECT * FROM bot_config WHERE guild_id = ?').get(guild.id);
  const [partySystem, partyLobbies] = await Promise.all([
    ensureCategory(guild, 'SISTEM PARTY', old?.create_category_id, ['PARTY SYSTEM']),
    ensureCategory(guild, 'LOBI PARTY', old?.party_lobby_category_id, ['PARTY LOBBIES']),
  ]);
  const [createChannel, listChannel] = await Promise.all([
    ensureTextChannel(guild, partySystem, 'buat-party', old?.create_channel_id, ['create-party']),
    ensureTextChannel(guild, partySystem, 'daftar-party', old?.party_list_channel_id, ['party-list']),
  ]);
  const createMessage = await ensurePanel(createChannel, old?.create_panel_message_id, createPanel(), 'party:create');
  const roleIds = config.lobbyViewRoleIds.filter((roleId) => guild.roles.cache.has(roleId));
  const invalidRoleIds = config.lobbyViewRoleIds.filter((roleId) => !guild.roles.cache.has(roleId));
  if (invalidRoleIds.length) logger.warn('Role lobi berikut tidak ditemukan di server dan akan diabaikan.', { invalidRoleIds });
  db.prepare(`
    INSERT INTO bot_config
      (guild_id, create_category_id, create_channel_id, party_list_channel_id,
       party_lobby_category_id, create_panel_message_id, lobby_view_role_ids, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(guild_id) DO UPDATE SET
      create_category_id = excluded.create_category_id,
      create_channel_id = excluded.create_channel_id,
      party_list_channel_id = excluded.party_list_channel_id,
      party_lobby_category_id = excluded.party_lobby_category_id,
      create_panel_message_id = excluded.create_panel_message_id,
      lobby_view_role_ids = excluded.lobby_view_role_ids,
      updated_at = datetime('now')
  `).run(
    guild.id,
    partySystem.id,
    createChannel.id,
    listChannel.id,
    partyLobbies.id,
    createMessage.id,
    JSON.stringify(roleIds),
  );
  return { createChannel, listChannel, partySystem, partyLobbies };
}

export async function handleSetup(
  interaction,
  client,
  config,
  partyListService,
  logger,
  recoveryService,
  inactivityService,
) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ content: 'Hanya administrator server yang dapat menjalankan pengaturan.', ephemeral: true });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  try {
    const guild = interaction.guild;
    if (!guild || guild.id !== config.guildId) throw new Error('Bot ini dikonfigurasi untuk server lain.');
    const botMember = await guild.members.fetchMe();
    const required = [
      PermissionFlagsBits.ManageChannels,
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.ManageRoles,
    ];
    const missing = required.filter((permission) => !botMember.permissions.has(permission));
    if (missing.length) {
      throw new Error('Bot belum memiliki izin yang diperlukan: Kelola Kanal, Kelola Peran, Lihat Kanal, Kirim Pesan, Sematkan Tautan, dan Baca Riwayat Pesan.');
    }

    await ensureServerStructure(client, guild, config, logger);
    if (recoveryService) await recoveryService.recover(guild);
    else await partyListService.refresh(guild.id, 0);
    if (inactivityService) {
      await inactivityService.sweep();
      inactivityService.start();
    }
    client.partySystemReady = true;
    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('Pengelola Party The Forge siap digunakan')
      .setDescription('Kategori, kanal, dan panel party sudah disiapkan. Jalankan `/setup` lagi kapan saja untuk memperbaikinya.');
    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    logger.error('Pengaturan server gagal.', { guildId: interaction.guildId, error: error.message });
    await interaction.editReply({
      content: error.message.startsWith('Bot belum memiliki')
        ? error.message
        : 'Pengaturan gagal diselesaikan. Periksa izin bot dan konfigurasi server, lalu coba lagi.',
    });
  }
}

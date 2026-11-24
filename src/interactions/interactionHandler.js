import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  UserSelectMenuBuilder,
} from 'discord.js';
import { createPartyModal, joinCodeModal } from './createParty.js';
import { logger as defaultLogger } from '../utils/logger.js';
import { UserFacingError } from '../utils/errors.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };

function selectionPrompt(kind, partyId) {
  const labels = {
    invite: ['Pilih anggota server yang ingin diundang.', 1],
    kick: ['Pilih anggota party yang ingin dikeluarkan.', 1],
    transfer: ['Pilih anggota party yang akan menjadi host.', 1],
  };
  const [placeholder, maxValues] = labels[kind];
  return {
    content: placeholder,
    components: [new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId(`party:${kind}_select:${partyId}`)
        .setPlaceholder(placeholder)
        .setMinValues(1)
        .setMaxValues(maxValues),
    )],
    ...EPHEMERAL,
  };
}

function confirmationPrompt(action, partyId, userId, targetId = '') {
  const messages = {
    leave: 'Yakin ingin keluar dari party ini? Jika kamu anggota terakhir, party dan lobi akan ditutup.',
    kick: `Keluarkan <@${targetId}> dari party ini?`,
    transfer: `Jadikan <@${targetId}> sebagai host party?`,
    close: 'Party akan ditutup permanen: semua anggota dikeluarkan, kode dinonaktifkan, party dihapus dari daftar umum, dan lobi dihapus.',
  };
  const customId = ['confirm', action, partyId, targetId || '-', userId].join(':');
  return {
    content: messages[action],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${customId}:yes`).setLabel('YA, LANJUTKAN').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`${customId}:no`).setLabel('BATALKAN').setStyle(ButtonStyle.Secondary),
    )],
    ...EPHEMERAL,
  };
}

async function privateNotify(client, userId, message, logger) {
  try {
    const user = await client.users.fetch(userId);
    await user.send({ content: message, allowedMentions: { parse: [] } });
  } catch (error) {
    logger.debug('Notifikasi party tidak dapat dikirim melalui pesan pribadi.', { userId, error: error.message });
  }
}

async function acknowledge(interaction, response) {
  if (interaction.deferred || interaction.replied) return interaction.followUp(response);
  return interaction.reply(response);
}

export function registerInteractionHandler(client, services, config, log = defaultLogger) {
  const { partyService, lobbyService, partyListService, recoveryService, inactivityService } = services;

  client.on('interactionCreate', async (interaction) => {
    try {
      if (interaction.guildId && interaction.guildId !== config.guildId) {
        await acknowledge(interaction, { content: 'Bot ini dikonfigurasi untuk server lain.', ...EPHEMERAL });
        return;
      }
      if (interaction.isChatInputCommand() && interaction.commandName === 'setup') {
        const { handleSetup } = await import('../commands/setup.js');
        await handleSetup(
          interaction,
          client,
          config,
          partyListService,
          log,
          recoveryService,
          inactivityService,
        );
        return;
      }
      if (!client.partySystemReady) {
        throw new UserFacingError('Sistem party belum siap. Minta administrator server menjalankan `/setup`.');
      }
      if (!interaction.guildId && (
        interaction.isButton() || interaction.isModalSubmit() || interaction.isUserSelectMenu()
      )) {
        await acknowledge(interaction, { content: 'Fitur party hanya tersedia di server yang sudah dikonfigurasi.', ...EPHEMERAL });
        return;
      }

      if (interaction.isButton()) {
        const [scope, action, partyId] = interaction.customId.split(':');
        if (scope === 'party' && action === 'create') {
          await interaction.showModal(createPartyModal());
          return;
        }
        if (scope === 'party' && action === 'join_code') {
          await interaction.showModal(joinCodeModal());
          return;
        }
        if (scope === 'partylist') {
          await interaction.deferUpdate();
          const settings = client.database.prepare('SELECT * FROM bot_config WHERE guild_id = ?')
            .get(interaction.guildId);
          const count = partyService.publicParties().length;
          const maxPage = Math.max(0, Math.ceil(count / config.partiesPerPage) - 1);
          const current = settings?.party_list_page ?? 0;
          const next = action === 'next' ? Math.min(current + 1, maxPage)
            : action === 'prev' ? Math.max(current - 1, 0) : current;
          await partyListService.refresh(interaction.guildId, action === 'refresh' ? current : next);
          return;
        }
        if (scope === 'confirm') {
          await handleConfirmation(interaction, client, services, config, log);
          return;
        }
        if (scope === 'party') {
          await handlePartyButton(interaction, action, partyId, client, services, config, log);
          return;
        }
        throw new UserFacingError('Kontrol ini tidak valid atau sudah kedaluwarsa.');
      }

      if (interaction.isChatInputCommand()) {
        await interaction.reply({ content: 'Perintah tersebut tidak tersedia.', ...EPHEMERAL });
        return;
      }

      if (interaction.isModalSubmit()) {
        if (interaction.customId === 'party:create_submit') {
          await createPartySubmit(interaction, client, services, config, log);
        } else if (interaction.customId === 'party:join_code_submit') {
          await joinCodeSubmit(interaction, services);
        } else {
          throw new UserFacingError('Formulir ini tidak valid atau sudah kedaluwarsa.');
        }
        return;
      }

      if (interaction.isUserSelectMenu()) {
        await handleUserSelection(interaction, client, services, log);
        return;
      }

      if (interaction.isStringSelectMenu()) {
        throw new UserFacingError('Pilihan ini tidak valid atau sudah kedaluwarsa.');
      }
    } catch (error) {
      log.error('Interaksi gagal diproses.', {
        customId: interaction.customId,
        userId: interaction.user?.id,
        error: error.stack ?? error.message,
      });
      const message = error instanceof UserFacingError
        ? error.message
        : 'Terjadi kesalahan saat memproses tindakan tersebut. Silakan coba lagi.';
      try {
        await acknowledge(interaction, { content: message, ...EPHEMERAL });
      } catch (replyError) {
        log.warn('Pesan kesalahan interaksi tidak dapat dikirim.', { error: replyError.message });
      }
    }
  });
}

async function createPartySubmit(interaction, client, { partyService, lobbyService, partyListService }, config, log) {
  await interaction.deferReply(EPHEMERAL);
  let party;
  try {
    party = partyService.createParty(interaction.user.id, {
      type: interaction.fields.getStringSelectValues('create:type')[0],
      tier: interaction.fields.getStringSelectValues('create:tier')[0],
      visibility: interaction.fields.getStringSelectValues('create:visibility')[0],
      name: interaction.fields.getTextInputValue('create:name'),
      description: interaction.fields.getTextInputValue('create:description'),
    });
    const guild = await client.guilds.fetch(config.guildId);
    const lobby = await lobbyService.ensureLobby(guild, party);
    await partyListService.refresh(guild.id);
    await interaction.editReply({
      content: `Party ${party.visibility === 'PUBLIC' ? 'umum' : 'pribadi'} **${party.name}** berhasil dibuat di <#${lobby.id}>. Kode Party: \`${party.code}\``,
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    if (party) {
      try {
        partyService.beginClose(party.id, party.leader_id);
        const tasks = partyService.cleanupTasks().filter((task) => task.party_id === party.id);
        for (const task of tasks) {
          try {
            await lobbyService.deleteLobby(task.lobby_channel_id);
            partyService.completeClose(party.id);
          } catch (cleanupError) {
            partyService.recordCleanupFailure(task.id, cleanupError.message);
          }
        }
      } catch (cleanupError) {
        log.error('Gagal membersihkan party yang tidak selesai dibuat.', { partyId: party.id, error: cleanupError.message });
      }
    }
    throw error;
  }
}

async function joinCodeSubmit(interaction, { partyService, lobbyService, partyListService }) {
  await interaction.deferReply(EPHEMERAL);
  const party = partyService.joinByCode(interaction.fields.getTextInputValue('join:code'), interaction.user.id);
  const joined = await syncJoinedParty(party, interaction.user.id, partyService, lobbyService, partyListService, interaction.guildId);
  await interaction.editReply({
    content: `Kamu bergabung dengan **${joined.name}**. Buka <#${joined.lobby_channel_id}> untuk menemui anggota party.`,
    allowedMentions: { parse: [] },
  });
}

async function syncJoinedParty(party, userId, partyService, lobbyService, partyListService, guildId, log = defaultLogger) {
  try {
    await lobbyService.updateLobby(party.id);
    await partyListService.refresh(guildId);
    return partyService.getParty(party.id);
  } catch (error) {
    try {
      partyService.leaveParty(party.id, userId);
      await lobbyService.updateLobby(party.id);
      await partyListService.refresh(guildId);
    } catch (rollbackError) {
      log.error('Gagal membatalkan keanggotaan setelah sinkronisasi lobi bermasalah.', {
        partyId: party.id,
        userId,
        error: rollbackError.message,
      });
    }
    throw error;
  }
}

async function requirePartyMember(partyService, partyId, userId) {
  const party = partyService.getParty(partyId);
  if (!party || !party.members.some((member) => member.user_id === userId)) {
    throw new UserFacingError('Kamu bukan anggota party aktif ini.');
  }
  return party;
}

async function handlePartyButton(interaction, action, partyId, client, { partyService, lobbyService, partyListService }, config, log) {
  if (action === 'join') {
    await interaction.deferReply(EPHEMERAL);
    const joined = partyService.joinParty(partyId, interaction.user.id, { requirePublic: true });
    const updated = await syncJoinedParty(joined, interaction.user.id, partyService, lobbyService, partyListService, interaction.guildId, log);
    await interaction.editReply({
      content: `Kamu bergabung dengan **${updated.name}**. Buka <#${updated.lobby_channel_id}> untuk menemui anggota party.`,
      allowedMentions: { parse: [] },
    });
    return;
  }
  const party = await requirePartyMember(partyService, partyId, interaction.user.id);
  const isLeader = party.leader_id === interaction.user.id;
  if (action === 'invite') {
    await interaction.reply(selectionPrompt('invite', partyId));
    return;
  }
  if (action === 'code') {
    await interaction.reply({ content: `Kode Party kamu:\n\`${party.code}\``, ...EPHEMERAL });
    return;
  }
  if (action === 'refresh') {
    await interaction.deferReply(EPHEMERAL);
    await lobbyService.updateLobby(partyId);
    await interaction.editReply({ content: 'Informasi party berhasil diperbarui.', allowedMentions: { parse: [] } });
    return;
  }
  if (action === 'leave') {
    await interaction.reply(confirmationPrompt('leave', partyId, interaction.user.id));
    return;
  }
  if (['kick', 'transfer', 'close'].includes(action) && !isLeader) {
    throw new UserFacingError('Hanya host party saat ini yang dapat melakukan tindakan tersebut.');
  }
  if (action === 'kick' || action === 'transfer') {
    await interaction.reply(selectionPrompt(action, partyId));
  } else if (action === 'close') {
    await interaction.reply(confirmationPrompt('close', partyId, interaction.user.id));
  } else throw new UserFacingError('Tindakan ini tidak valid atau sudah kedaluwarsa.');
}

async function handleUserSelection(interaction, client, { partyService, lobbyService, partyListService }, log) {
  const [, selectionAction, partyId] = interaction.customId.split(':');
  const action = selectionAction.replace('_select', '');
  if (!['invite', 'kick', 'transfer'].includes(action) || !partyId) {
    throw new UserFacingError('Pilihan ini tidak valid atau sudah kedaluwarsa.');
  }
  const party = await requirePartyMember(partyService, partyId, interaction.user.id);
  if (['kick', 'transfer'].includes(action) && party.leader_id !== interaction.user.id) {
    throw new UserFacingError('Hanya host party saat ini yang dapat melakukan tindakan tersebut.');
  }
  const targetId = interaction.values[0];
  if (action === 'invite') {
    await interaction.deferReply(EPHEMERAL);
    const targetMember = await interaction.guild.members.fetch(targetId);
    if (targetMember.user.bot) throw new UserFacingError('Bot tidak dapat bergabung ke party.');
    const updated = partyService.inviteMember(partyId, interaction.user.id, targetId);
    const joined = await syncJoinedParty(updated, targetId, partyService, lobbyService, partyListService, interaction.guildId, log);
    await privateNotify(client, targetId, `Kamu telah bergabung ke **${joined.name}** di The Forge. Kode Party: ${joined.code}`, log);
    await interaction.editReply({ content: `<@${targetId}> bergabung ke **${joined.name}**.`, allowedMentions: { parse: [] } });
    return;
  }
  if (!party.members.some((member) => member.user_id === targetId) || targetId === interaction.user.id) {
    throw new UserFacingError('Pilih anggota party yang memenuhi syarat.');
  }
  await interaction.reply(confirmationPrompt(action, partyId, interaction.user.id, targetId));
}

async function handleConfirmation(interaction, client, { partyService, lobbyService, partyListService }, config, log) {
  const [, action, partyId, targetId, ownerId, decision] = interaction.customId.split(':');
  if (!['leave', 'kick', 'transfer', 'close'].includes(action) || !partyId || !ownerId) {
    throw new UserFacingError('Konfirmasi ini tidak valid atau sudah kedaluwarsa.');
  }
  if (ownerId !== interaction.user.id) throw new UserFacingError('Konfirmasi ini milik pengguna lain.');
  await interaction.deferUpdate();
  if (decision !== 'yes') {
    await interaction.editReply({ content: 'Tindakan dibatalkan.', components: [], allowedMentions: { parse: [] } });
    return;
  }

  const before = partyService.getParty(partyId);
  if (!before) throw new UserFacingError('Party ini sudah tidak aktif.');
  const selectedTargetId = targetId === '-' ? '' : targetId;
  if (action === 'leave') {
    const result = partyService.leaveParty(partyId, interaction.user.id);
    if (result.closed) {
      await partyListService.refresh(interaction.guildId);
      await closeAndNotify(result.party, before.members, partyService, lobbyService, client, log);
      await interaction.editReply({ content: 'Kamu adalah anggota terakhir; party telah ditutup.', components: [], allowedMentions: { parse: [] } });
      return;
    }
    await lobbyService.updateLobby(partyId);
    await partyListService.refresh(interaction.guildId);
    await interaction.editReply({ content: 'Kamu telah keluar dari party.', components: [], allowedMentions: { parse: [] } });
  } else if (action === 'kick') {
    partyService.kickMember(partyId, interaction.user.id, selectedTargetId);
    await lobbyService.updateLobby(partyId);
    await partyListService.refresh(interaction.guildId);
    await privateNotify(client, selectedTargetId, `Kamu telah dikeluarkan dari **${before.name}**.`, log);
    await interaction.editReply({ content: `<@${selectedTargetId}> telah dikeluarkan dari party.`, components: [], allowedMentions: { parse: [] } });
  } else if (action === 'transfer') {
    partyService.transferLeader(partyId, interaction.user.id, selectedTargetId);
    await lobbyService.updateLobby(partyId);
    await partyListService.refresh(interaction.guildId);
    await privateNotify(client, interaction.user.id, `Kamu telah menyerahkan posisi host **${before.name}** kepada <@${selectedTargetId}>.`, log);
    await privateNotify(client, selectedTargetId, `Sekarang kamu menjadi host **${before.name}**.`, log);
    await interaction.editReply({ content: `Host party dipindahkan kepada <@${selectedTargetId}>.`, components: [], allowedMentions: { parse: [] } });
  } else if (action === 'close') {
    const closing = partyService.beginClose(partyId, interaction.user.id);
    await partyListService.refresh(interaction.guildId);
    await closeAndNotify(closing, before.members, partyService, lobbyService, client, log);
    await interaction.editReply({ content: 'Party telah ditutup.', components: [], allowedMentions: { parse: [] } });
  }
}

async function closeAndNotify(party, members, partyService, lobbyService, client, log) {
  const task = partyService.cleanupTasks().find((item) => item.party_id === party.id);
  if (task) {
    try {
      await lobbyService.deleteLobby(task.lobby_channel_id);
      partyService.completeClose(party.id);
    } catch (error) {
      partyService.recordCleanupFailure(task.id, error.message);
      log.warn('Penutupan party masuk antrean untuk dicoba kembali.', { partyId: party.id, error: error.message });
    }
  }
  await Promise.all(members.map((member) =>
    privateNotify(client, member.user_id, `Party The Forge **${party.name}** telah ditutup.`, log),
  ));
}

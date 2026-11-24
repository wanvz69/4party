import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { displayPartyType, displayStatus, displayVisibility } from '../utils/validation.js';

const colors = { RECRUITING: 0x2ecc71, FULL: 0xe67e22, CLOSED: 0xe74c3c };

export function buildPartyLobby(party) {
  const memberList = party.members.map((member, index) =>
    `${index + 1}. <@${member.user_id}>${member.member_role === 'LEADER' ? ' 👑' : ''}`,
  ).join('\n') || 'Belum ada anggota';
  const embed = new EmbedBuilder()
    .setColor(colors[party.status] ?? 0x263b68)
    .setTitle('THE FORGE | LOBI PARTY')
    .setDescription([
      `**${party.name}**`,
      party.description || '',
      '',
      `**Kode Party:** \`${party.code}\``,
      `**Jenis Party:** ${displayPartyType(party.type)}`,
      `**Tingkatan Raid:** ${party.tier}`,
      `**Visibilitas:** ${displayVisibility(party.visibility)}`,
      `**Status:** ${displayStatus(party.status)}`,
      `**Leader:** <@${party.leader_id}>`,
      '',
      `**ANGGOTA (${party.member_count}/${party.max_members})**`,
      memberList,
    ].filter(Boolean).join('\n'));

  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`party:invite:${party.id}`).setLabel('UNDANG ANGGOTA').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`party:code:${party.id}`).setLabel('KODE PARTY').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`party:refresh:${party.id}`).setLabel('MUAT ULANG').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`party:leave:${party.id}`).setLabel('KELUAR PARTY').setStyle(ButtonStyle.Danger),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`party:kick:${party.id}`).setLabel('KELUARKAN ANGGOTA').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`party:transfer:${party.id}`).setLabel('PINDAHKAN HOST').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`party:close:${party.id}`).setLabel('TUTUP PARTY').setStyle(ButtonStyle.Danger),
    ),
  ];
  return { embeds: [embed], components: rows, allowedMentions: { parse: [] } };
}

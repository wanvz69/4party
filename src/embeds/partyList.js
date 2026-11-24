import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { displayPartyType, truncate } from '../utils/validation.js';

export function buildPartyList(parties, page, pageSize) {
  const pageCount = Math.max(1, Math.ceil(parties.length / pageSize));
  const currentPage = Math.min(Math.max(0, page), pageCount - 1);
  const visible = parties.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const embed = new EmbedBuilder()
    .setColor(0x263b68)
    .setTitle('THE FORGE | DAFTAR PARTY UMUM')
    .setDescription([
      'Jelajahi party umum yang tersedia dan temukan teman untuk raid',
      '',
      visible.length ? '' : 'Belum ada party umum yang mencari anggota. Coba lagi nanti!',
    ].filter(Boolean).join('\n'))
    .setFooter({ text: `Halaman ${currentPage + 1}/${pageCount} • ${parties.length} party mencari anggota` });

  for (const party of visible) {
    const members = party.members.map((member) => `<@${member.user_id}>`).join(', ');
    const details = [
      `**Kode Party:** \`${party.code}\``,
      `**Jenis:** ${displayPartyType(party.type)} • **Tingkatan:** ${party.tier}`,
      `**Host:** <@${party.leader_id}>`,
      `**Anggota:** ${party.member_count}/${party.max_members} • **Status:** Mencari anggota`,
      party.description ? `**Deskripsi:** ${truncate(party.description, 220)}` : null,
      `**ID Party:** \`${party.id}\``,
      members ? `**Dalam party:** ${truncate(members, 350)}` : null,
    ].filter(Boolean).join('\n');
    embed.addFields({ name: truncate(party.name, 256), value: truncate(details, 1024) });
  }

  const rows = [];
  for (let offset = 0; offset < visible.length; offset += 5) {
    rows.push(new ActionRowBuilder().addComponents(
      ...visible.slice(offset, offset + 5).map((party) =>
        new ButtonBuilder()
          .setCustomId(`party:join:${party.id}`)
          .setLabel(`GABUNG ${truncate(party.name, 59)}`)
          .setStyle(ButtonStyle.Success),
      ),
    ));
  }
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('partylist:prev').setLabel('SEBELUMNYA').setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage === 0),
    new ButtonBuilder().setCustomId('partylist:refresh').setLabel('MUAT ULANG').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('partylist:next').setLabel('BERIKUTNYA').setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage >= pageCount - 1),
  ));
  return { embeds: [embed], components: rows, page: currentPage, allowedMentions: { parse: [] } };
}

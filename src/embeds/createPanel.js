import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';

export function createPanel() {
  const embed = new EmbedBuilder()
    .setColor(0x263b68)
    .setTitle('THE FORGE | PARTY MANAGER')
    .setDescription([
      'Bentuk party, temukan teman bermain, dan mulai petualangan bersama di The Forge!',
      '',
      'Gunakan sistem ini untuk membuat party sendiri, bergabung menggunakan kode party, atau mencari party yang sedang membuka slot anggota. Setiap party memiliki lobi khusus untuk berkomunikasi, mengatur anggota, dan mengelola aktivitas party.',
      '',
      '**PERHATIAN**',
      'Party yang tidak memiliki aktivitas chat selama 30 menit akan otomatis dihapus, termasuk channel lobi party terkait.',
      '',
      '**Find Your Party. Forge Your Journey.**',
    ].join('\n'));
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('party:create').setLabel('BUAT PARTY').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('party:join_code').setLabel('GABUNG DENGAN KODE').setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row], allowedMentions: { parse: [] } };
}

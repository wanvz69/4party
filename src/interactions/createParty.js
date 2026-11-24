import {
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

function select(label, customId, options) {
  return new LabelBuilder()
    .setLabel(label)
    .setStringSelectMenuComponent(new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(`Pilih ${label.toLowerCase()}`)
      .setRequired(true)
      .addOptions(options));
}

function text(label, customId, style, maxLength, required = false) {
  const input = new TextInputBuilder()
    .setCustomId(customId)
    .setStyle(style)
    .setRequired(required)
    .setMaxLength(maxLength);
  return new LabelBuilder().setLabel(label).setTextInputComponent(input);
}

export function createPartyModal() {
  return new ModalBuilder()
    .setCustomId('party:create_submit')
    .setTitle('Buat Party The Forge')
    .addLabelComponents(
      select('JENIS PARTY', 'create:type', [
        { label: 'HOST', description: 'Buat dan kelola party raid sendiri.', value: 'HOST' },
        { label: 'BUTUH BANTUAN', description: 'Mencari bantuan untuk progres raid.', value: 'CARRY' },
        { label: 'CARI TIM', description: 'Mencari teman untuk bermain bersama.', value: 'LOOKING FOR' },
      ]),
      select('TINGKATAN RAID', 'create:tier', Array.from({ length: 15 }, (_, index) => ({
        label: `Tingkatan ${index + 1}`,
        value: String(index + 1),
      }))),
      select('VISIBILITAS PARTY', 'create:visibility', [
        { label: 'UMUM', description: 'Tampil di daftar dan dapat dimasuki dengan kode.', value: 'PUBLIC' },
        { label: 'PRIBADI', description: 'Tidak tampil di daftar; hanya dapat dimasuki dengan Kode Party.', value: 'PRIVATE' },
      ]),
      text('NAMA PARTY (OPSIONAL)', 'create:name', TextInputStyle.Short, 80),
      text('DESKRIPSI (OPSIONAL)', 'create:description', TextInputStyle.Paragraph, 500),
    );
}

export function joinCodeModal() {
  const code = new TextInputBuilder()
    .setCustomId('join:code')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(5)
    .setMaxLength(5)
    .setPlaceholder('Contoh: A82KX');
  return new ModalBuilder()
    .setCustomId('party:join_code_submit')
    .setTitle('Gabung dengan Kode Party')
    .addLabelComponents(new LabelBuilder().setLabel('KODE PARTY').setTextInputComponent(code));
}

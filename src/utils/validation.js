export const PARTY_TYPES = ['HOST', 'CARRY', 'LOOKING FOR'];
export const RAID_TIERS = Array.from({ length: 15 }, (_, index) => index + 1);
export const VISIBILITIES = ['PUBLIC', 'PRIVATE'];

export function displayPartyType(type) {
  return { HOST: 'HOST', CARRY: 'BUTUH BANTUAN', 'LOOKING FOR': 'CARI TIM' }[type] ?? type;
}

export function displayVisibility(visibility) {
  return { PUBLIC: 'UMUM', PRIVATE: 'PRIBADI' }[visibility] ?? visibility;
}

export function displayStatus(status) {
  return { RECRUITING: 'MENCARI ANGGOTA', FULL: 'PENUH', CLOSED: 'DITUTUP' }[status] ?? status;
}

export function validatePartyInput(input) {
  const type = String(input.type ?? '').trim();
  const tier = Number(input.tier);
  const visibility = String(input.visibility ?? '').trim();
  const name = String(input.name ?? '').trim();
  const description = String(input.description ?? '').trim();

  if (!PARTY_TYPES.includes(type)) throw new UserFacingError('Pilih jenis party yang valid.');
  if (!RAID_TIERS.includes(tier)) throw new UserFacingError('Pilih tingkatan raid dari 1 sampai 15.');
  if (!VISIBILITIES.includes(visibility)) throw new UserFacingError('Pilih visibilitas party yang valid.');
  if (name.length > 80) throw new UserFacingError('Nama party maksimal 80 karakter.');
  if (description.length > 500) throw new UserFacingError('Deskripsi maksimal 500 karakter.');

  return {
    type,
    tier,
    visibility,
    name: name || `${displayPartyType(type)} | Tingkatan ${tier}`,
    description,
  };
}

export function normalizePartyCode(value) {
  return String(value ?? '').replace(/\s+/g, '').toUpperCase();
}

export function truncate(value, limit) {
  const text = String(value ?? '');
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}
import { UserFacingError } from './errors.js';

import 'dotenv/config';
import path from 'node:path';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variabel lingkungan wajib belum diisi: ${name}`);
  return value;
}

const roleIds = (process.env.LOBBY_VIEW_ROLE_IDS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

export const config = {
  token: required('DISCORD_TOKEN'),
  clientId: required('CLIENT_ID'),
  guildId: required('GUILD_ID'),
  lobbyViewRoleIds: roleIds,
  databasePath: path.resolve(process.cwd(), process.env.DATABASE_PATH ?? './data/party.sqlite'),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  maxPartyMembers: 10,
  partiesPerPage: 10,
};

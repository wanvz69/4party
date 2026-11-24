import { Client, GatewayIntentBits, Events } from 'discord.js';
import { config } from './config/config.js';
import { openDatabase } from './database/database.js';
import { logger } from './utils/logger.js';
import { PartyService } from './services/partyService.js';
import { LobbyService } from './services/lobbyService.js';
import { PartyListService } from './services/partyListService.js';
import { RecoveryService } from './services/recoveryService.js';
import { InactivityService } from './services/inactivityService.js';
import { ensureServerStructure } from './commands/setup.js';
import { registerInteractionHandler } from './interactions/interactionHandler.js';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages],
});
const database = openDatabase(config.databasePath);
client.database = database;
client.partySystemReady = false;

const partyService = new PartyService(database, config.maxPartyMembers);
const lobbyService = new LobbyService(client, partyService, config, logger);
const partyListService = new PartyListService(client, partyService, config, logger);
const recoveryService = new RecoveryService(
  client,
  partyService,
  lobbyService,
  partyListService,
  config,
  logger,
);
const inactivityService = new InactivityService(
  client,
  partyService,
  recoveryService,
  partyListService,
  config,
  logger,
);
inactivityService.register();

registerInteractionHandler(client, {
  partyService,
  lobbyService,
  partyListService,
  recoveryService,
  inactivityService,
}, config, logger);

client.once(Events.ClientReady, async (readyClient) => {
  logger.info('Terhubung ke Discord.', { user: readyClient.user.tag, guildId: config.guildId });
  try {
    const guild = await readyClient.guilds.fetch(config.guildId);
    const configured = database.prepare('SELECT 1 FROM bot_config WHERE guild_id = ?').get(guild.id);
    if (configured) {
      await ensureServerStructure(readyClient, guild, config, logger);
      await recoveryService.recover(guild);
      await inactivityService.sweep();
      inactivityService.start();
      readyClient.partySystemReady = true;
      logger.info('Pemulihan sistem party saat mulai berhasil.');
    } else {
      logger.info('Pengaturan sistem party belum dilakukan; administrator server perlu menjalankan /setup.');
    }
  } catch (error) {
    logger.error('Pemulihan saat mulai gagal; fitur party mungkin tidak tersedia sampai pengaturan diperbaiki.', {
      error: error.stack ?? error.message,
    });
  }
});

client.on(Events.Error, (error) => logger.error('Terjadi kesalahan pada klien Discord.', { error: error.message }));
process.on('unhandledRejection', (error) => logger.error('Promise ditolak tanpa penanganan.', { error: String(error) }));
process.on('SIGINT', () => {
  logger.info('Bot sedang dimatikan.');
  inactivityService.stop();
  database.close();
  client.destroy();
  process.exit(0);
});
process.on('SIGTERM', () => {
  logger.info('Bot sedang dimatikan.');
  inactivityService.stop();
  database.close();
  client.destroy();
  process.exit(0);
});

await client.login(config.token);

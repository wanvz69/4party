import { REST, Routes } from 'discord.js';
import { config } from './config/config.js';
import { setupCommand } from './commands/setup.js';

const rest = new REST({ version: '10' }).setToken(config.token);
await rest.put(
  Routes.applicationGuildCommands(config.clientId, config.guildId),
  { body: [setupCommand.toJSON()] },
);
console.log('Perintah /setup berhasil didaftarkan ke server yang dikonfigurasi.');

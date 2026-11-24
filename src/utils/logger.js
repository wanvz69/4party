const levels = { error: 0, warn: 1, info: 2, debug: 3 };
const configuredLevel = process.env.LOG_LEVEL ?? 'info';
const threshold = levels[configuredLevel] ?? levels.info;

function write(level, message, details) {
  if (levels[level] > threshold) return;
  const output = {
    time: new Date().toISOString(),
    level,
    message,
    ...(details === undefined ? {} : { details }),
  };
  const line = JSON.stringify(output);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  error: (message, details) => write('error', message, details),
  warn: (message, details) => write('warn', message, details),
  info: (message, details) => write('info', message, details),
  debug: (message, details) => write('debug', message, details),
};

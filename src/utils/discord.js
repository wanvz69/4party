export function isUnknownChannel(error) {
  return Number(error?.code) === 10003;
}

export function isUnknownMessage(error) {
  return Number(error?.code) === 10008;
}

export async function fetchOrNull(fetch, isMissing) {
  try {
    return await fetch();
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

export async function findBotComponentMessage(channel, clientUserId, customId) {
  const messages = await channel.messages.fetch({ limit: 100 });
  return messages.find((message) =>
    message.author.id === clientUserId
    && message.components.some((row) => row.components.some((component) => component.customId === customId)),
  ) ?? null;
}

export async function findBotEmbedMessage(channel, clientUserId, title) {
  const messages = await channel.messages.fetch({ limit: 100 });
  return messages.find((message) =>
    message.author.id === clientUserId
    && message.embeds.some((embed) => embed.title === title),
  ) ?? null;
}

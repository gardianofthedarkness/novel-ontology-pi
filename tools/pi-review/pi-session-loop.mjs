import { setTimeout as delay } from 'node:timers/promises';

export async function runConsoleSession({ console: channel, session, deadline, stopped, afterTurn, onIdle, onBusy, redact = text => text, interval = 250 }) {
  let messages = [];
  await channel.setStatus('ready', 'Pi ready. Your messages go to the scoped novel agent, not an unrestricted shell.', true);
  await onIdle?.();
  let heartbeatError = null;
  const heartbeat = setInterval(() => { void channel.touchHeartbeat().catch(error => { heartbeatError = error; }); }, 5000);
  try {
    while (!stopped() && Date.now() < deadline) {
      if (heartbeatError) throw new Error('Pi console heartbeat failed');
      messages = await channel.takeMessages();
      if (!messages.length) { await delay(interval); continue; }
      for (const message of messages) {
        if (stopped() || Date.now() >= deadline) break;
        await channel.setStatus('working', 'Pi is processing your message. Further messages wait for this turn to finish.', true);
        await onBusy?.();
        try {
          await session.prompt(message.text);
          const last = session.messages.filter(entry => entry.role === 'assistant').at(-1);
          if (stopped() || ['length', 'error', 'aborted'].includes(last?.stopReason)) throw new Error('Pi turn interrupted');
          const text = session.getLastAssistantText()?.trim();
          if (text) await channel.record({ kind: 'assistant', text: redact(text), status: 'ok' });
          await afterTurn?.();
          await channel.finishMessage(message.id, 'consumed');
        } catch {
          await channel.finishMessage(message.id, 'failed');
          await channel.record({ kind: 'status', text: 'Pi could not finish this message. No completion or approval is inferred; it will not be retried automatically.', status: 'error' });
        }
      }
      messages = [];
      if (!stopped() && Date.now() < deadline) {
        await channel.setStatus('ready', 'Pi is ready for your next message. Existing review gates remain enforced.', true);
        await onIdle?.();
      }
    }
  } finally {
    clearInterval(heartbeat);
    await channel.setStatus('stopped', 'Pi session ended. Unfinished messages are not automatically replayed.', false);
  }
}

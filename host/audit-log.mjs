import fs from 'node:fs';
import path from 'node:path';

export class AuditLog {
  constructor(directory) {
    this.directory = directory;
    fs.mkdirSync(directory, { recursive: true });
  }

  write(event) {
    const day = new Date().toISOString().slice(0, 10);
    const entry = {
      time: new Date().toISOString(),
      botId: String(event.botId || 'local').slice(0, 80),
      command: String(event.command || 'state').slice(0, 80),
      outcome: String(event.outcome || 'unknown').slice(0, 80),
      app: String(event.app || '').slice(0, 80)
    };
    fs.appendFileSync(path.join(this.directory, `audit-${day}.jsonl`), `${JSON.stringify(entry)}\n`, 'utf8');
    return entry;
  }
}

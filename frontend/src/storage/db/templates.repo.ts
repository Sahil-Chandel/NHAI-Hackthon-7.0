import {getDb} from './dbClient';
import type {Template} from '../vectorMatch';

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function insertTemplate(
  userId: string,
  name: string,
  embedding: number[],
  bioHash?: string,
  salt?: string,
): string {
  const db = getDb();
  const id = generateId();
  const embJson = JSON.stringify(embedding);

  db.execute(
    'INSERT INTO templates (id, user_id, name, emb, bio_hash, salt) VALUES (?, ?, ?, ?, ?, ?)',
    [id, userId, name, embJson, bioHash ?? null, salt ?? null],
  );

  return id;
}

export function getAllTemplates(): Template[] {
  const db = getDb();
  const result = db.execute('SELECT id, user_id, name, emb FROM templates');

  const templates: Template[] = [];
  if (result.rows) {
    for (let i = 0; i < result.rows.length; i++) {
      const row = result.rows.item(i);
      templates.push({
        id: row.id,
        userId: row.user_id,
        name: row.name,
        embedding: JSON.parse(row.emb),
      });
    }
  }
  return templates;
}

export function getTemplatesByUser(userId: string): Template[] {
  const db = getDb();
  const result = db.execute(
    'SELECT id, user_id, name, emb FROM templates WHERE user_id = ?',
    [userId],
  );

  const templates: Template[] = [];
  if (result.rows) {
    for (let i = 0; i < result.rows.length; i++) {
      const row = result.rows.item(i);
      templates.push({
        id: row.id,
        userId: row.user_id,
        name: row.name,
        embedding: JSON.parse(row.emb),
      });
    }
  }
  return templates;
}

export function deleteTemplate(id: string): void {
  const db = getDb();
  db.execute('DELETE FROM templates WHERE id = ?', [id]);
}

/**
 * Remove every template for a user_id. Called before (re)enrolling so a worker
 * who re-onboards (new device, retry after a transient error) ends up with one
 * current template instead of accumulating stale embeddings.
 */
export function deleteTemplatesForUser(userId: string): number {
  const db = getDb();
  const result = db.execute('DELETE FROM templates WHERE user_id = ?', [userId]);
  return (result as any)?.rowsAffected ?? 0;
}

/**
 * Wipe ALL templates whose user_id matches the given prefix. Used when an
 * admin deactivates a worker (`workers-` prefix) so that worker's biometric
 * embedding doesn't linger on the device — privacy + DPDPA obligation.
 *
 * NOTE: the user_id we get back from the new admin/worker creation flow is
 * something like `worker-l9w8e5xa`. The on-device prefix is derived from
 * the timestamp at enrollment, NOT the backend worker id. So we additionally
 * accept a name match to be safe.
 */
export function deleteTemplatesForName(name: string): number {
  const db = getDb();
  const result = db.execute(
    'DELETE FROM templates WHERE name = ?',
    [name],
  );
  return (result as any)?.rowsAffected ?? 0;
}

export function getTemplateCount(): number {
  const db = getDb();
  const result = db.execute('SELECT COUNT(*) as cnt FROM templates');
  return result.rows?.item(0)?.cnt ?? 0;
}

export function getBioHashData(
  id: string,
): {bioHash: string; salt: string} | null {
  const db = getDb();
  const result = db.execute(
    'SELECT bio_hash, salt FROM templates WHERE id = ?',
    [id],
  );
  if (result.rows && result.rows.length > 0) {
    const row = result.rows.item(0);
    if (row.bio_hash && row.salt) {
      return {bioHash: row.bio_hash, salt: row.salt};
    }
  }
  return null;
}

import express from 'express';
import pkg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pkg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, '..', 'public');

const app = express();
const port = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

app.use(express.json({ limit: '1mb' }));
app.use(express.static(publicDir));

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      month TEXT NOT NULL,
      appendix_number TEXT,
      project_name TEXT NOT NULL,
      counterparty TEXT NOT NULL,
      internal_number TEXT,
      tender_number TEXT,
      stage INTEGER NOT NULL DEFAULT 0,
      in_mkt BOOLEAN NOT NULL DEFAULT FALSE,
      comment TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

function normalizeDoc(row) {
  return {
    id: row.id,
    month: row.month,
    appendixNumber: row.appendix_number || '',
    projectName: row.project_name || '',
    counterparty: row.counterparty || '',
    internalNumber: row.internal_number || '',
    tenderNumber: row.tender_number || '',
    stage: Number(row.stage || 0),
    inMkt: Boolean(row.in_mkt),
    comment: row.comment || ''
  };
}

app.get('/api/health', async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true });
});

app.get('/api/documents', async (_req, res) => {
  const result = await pool.query('SELECT * FROM documents ORDER BY month DESC, stage ASC, updated_at DESC');
  res.json(result.rows.map(normalizeDoc));
});

app.get('/api/suppliers', async (_req, res) => {
  const result = await pool.query('SELECT name FROM suppliers ORDER BY name ASC');
  res.json(result.rows.map((row) => row.name));
});

app.post('/api/documents', async (req, res) => {
  const doc = req.body;
  if (!doc?.id || !doc?.month || !doc?.projectName || !doc?.counterparty) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  await pool.query(
    `INSERT INTO documents (id, month, appendix_number, project_name, counterparty, internal_number, tender_number, stage, in_mkt, comment, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
     ON CONFLICT (id) DO UPDATE SET
       month = EXCLUDED.month,
       appendix_number = EXCLUDED.appendix_number,
       project_name = EXCLUDED.project_name,
       counterparty = EXCLUDED.counterparty,
       internal_number = EXCLUDED.internal_number,
       tender_number = EXCLUDED.tender_number,
       stage = EXCLUDED.stage,
       in_mkt = EXCLUDED.in_mkt,
       comment = EXCLUDED.comment,
       updated_at = NOW()`,
    [
      doc.id,
      doc.month,
      doc.appendixNumber || '',
      doc.projectName,
      doc.counterparty,
      doc.internalNumber || '',
      doc.tenderNumber || '',
      Number(doc.stage || 0),
      Boolean(doc.inMkt),
      doc.comment || ''
    ]
  );

  if (doc.counterparty?.trim()) {
    await pool.query('INSERT INTO suppliers (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [doc.counterparty.trim()]);
  }

  const saved = await pool.query('SELECT * FROM documents WHERE id = $1', [doc.id]);
  res.json(normalizeDoc(saved.rows[0]));
});

app.delete('/api/documents/:id', async (req, res) => {
  await pool.query('DELETE FROM documents WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

initDb()
  .then(() => {
    app.listen(port, () => {
      console.log(`Document tracker app running on port ${port}`);
    });
  })
  .catch((error) => {
    console.error('Failed to initialize database', error);
    process.exit(1);
  });

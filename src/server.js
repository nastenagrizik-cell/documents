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
const appTimeZone = process.env.APP_TIME_ZONE || 'Europe/Moscow';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000
});

const TENDER_STAGE_RULES = Object.freeze({
  mine: 'На мне',
  yulia_ivan: 'Юля / Иван',
  finance: 'Финансисты',
  olya_k: 'Оля К',
  yulia_d: 'Юля Д',
  mikhail: 'Михаил',
  paperwork: 'Оформление'
});

app.use(express.json({ limit: '1mb' }));
app.use(express.static(publicDir));

function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return value.toISOString().slice(0, 10);
  }
  const match = String(value).match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function todayInAppTimeZone() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: appTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDaysToDate(dateValue, days) {
  const normalized = dateOnly(dateValue);
  if (!normalized) return null;
  const [year, month, day] = normalized.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function addDaysToTimestamp(dateInput, days) {
  const date = new Date(dateInput);
  date.setDate(date.getDate() + days);
  return date;
}

function normalizeStringList(values) {
  if (!Array.isArray(values)) return [];
  const unique = new Map();

  for (const value of values) {
    const name = String(value || '').trim();
    if (!name) continue;
    const key = name.toLocaleLowerCase('ru-RU');
    if (!unique.has(key)) unique.set(key, name);
  }

  return [...unique.values()];
}

function getTenderStageKeys(amountInput) {
  const amount = Number(amountInput);
  if (amount < 1_000_000) {
    return ['mine', 'yulia_ivan'];
  }
  if (amount < 3_000_000) {
    return ['mine', 'yulia_ivan', 'finance'];
  }
  if (amount < 7_000_000) {
    return ['mine', 'yulia_ivan', 'olya_k', 'yulia_d', 'paperwork'];
  }
  return ['mine', 'yulia_ivan', 'olya_k', 'yulia_d', 'mikhail', 'paperwork'];
}

function reconcileTenderStage(oldAmount, oldStage, newAmount) {
  const oldStages = getTenderStageKeys(oldAmount);
  const newStages = getTenderStageKeys(newAmount);
  const completedStages = oldStage === 'completed'
    ? new Set(oldStages)
    : new Set(oldStages.slice(0, Math.max(0, oldStages.indexOf(oldStage))));

  return newStages.find((stage) => !completedStages.has(stage)) || 'completed';
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
    targetYear: row.target_year ? Number(row.target_year) : null,
    comment: row.comment || '',
    approvalDate: row.approval_date || null,
    approvalDeadline: row.approval_deadline || null,
    approvedStartedAt: row.approved_started_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeTenderDecision(row) {
  const amount = Number(row.amount || 0);
  const stageKeys = getTenderStageKeys(amount);

  return {
    id: row.id,
    number: row.number || '',
    title: row.title || '',
    validFrom: dateOnly(row.valid_from),
    validTo: dateOnly(row.valid_to),
    amount,
    suppliers: normalizeStringList(row.suppliers),
    comment: row.comment || '',
    currentStage: row.current_stage || 'mine',
    stages: stageKeys.map((key) => ({ key, label: TENDER_STAGE_RULES[key] })),
    stageStartedOn: dateOnly(row.stage_started_on),
    stageDeadline: dateOnly(row.stage_deadline),
    yuliaApproved: Boolean(row.yulia_approved),
    ivanApproved: Boolean(row.ivan_approved),
    isReady: row.current_stage === 'completed',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function initDb() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(`
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
        target_year INTEGER,
        comment TEXT,
        approval_date TIMESTAMPTZ,
        approval_deadline TIMESTAMPTZ,
        approved_started_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      ALTER TABLE documents
      ADD COLUMN IF NOT EXISTS approval_date TIMESTAMPTZ
    `);
    await client.query(`
      ALTER TABLE documents
      ADD COLUMN IF NOT EXISTS approval_deadline TIMESTAMPTZ
    `);
    await client.query(`
      ALTER TABLE documents
      ADD COLUMN IF NOT EXISTS approved_started_at TIMESTAMPTZ
    `);
    await client.query(`
      ALTER TABLE documents
      ADD COLUMN IF NOT EXISTS target_year INTEGER
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS suppliers (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS tender_decisions (
        id TEXT PRIMARY KEY,
        number TEXT NOT NULL,
        title TEXT NOT NULL,
        valid_from DATE NOT NULL,
        valid_to DATE NOT NULL,
        amount NUMERIC(15, 2) NOT NULL,
        suppliers TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        comment TEXT,
        current_stage TEXT NOT NULL DEFAULT 'mine',
        stage_started_on DATE,
        stage_deadline DATE,
        yulia_approved BOOLEAN NOT NULL DEFAULT FALSE,
        ivan_approved BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      ALTER TABLE tender_decisions
      ADD COLUMN IF NOT EXISTS comment TEXT
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS tender_decisions_status_deadline_idx
      ON tender_decisions (current_stage, stage_deadline)
    `);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({ ok: false });
  }
});

app.get('/api/documents', async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM documents
      ORDER BY month DESC, stage ASC, updated_at DESC
    `);

    res.json(result.rows.map(normalizeDoc));
  } catch (error) {
    console.error('Fetch documents error:', error);
    res.status(500).json({ error: 'Не удалось загрузить документы' });
  }
});

app.get('/api/suppliers', async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT name
      FROM suppliers
      ORDER BY name ASC
    `);

    res.json(result.rows.map((row) => row.name));
  } catch (error) {
    console.error('Fetch suppliers error:', error);
    res.status(500).json({ error: 'Не удалось загрузить поставщиков' });
  }
});

app.post('/api/documents', async (req, res) => {
  try {
    const doc = req.body;

    if (!doc?.id || !doc?.month || !doc?.projectName || !doc?.counterparty) {
      return res.status(400).json({ error: 'Заполните обязательные поля документа' });
    }

    const incomingStage = Math.max(0, Math.min(2, Number(doc.stage || 0)));
    const targetYearValue = doc.targetYear === null || doc.targetYear === undefined || doc.targetYear === ''
      ? null
      : Number(doc.targetYear);

    if (targetYearValue !== null && (!Number.isInteger(targetYearValue) || targetYearValue < 2000 || targetYearValue > 2200)) {
      return res.status(400).json({ error: 'Некорректный год документа' });
    }

    const existingResult = await pool.query(
      'SELECT * FROM documents WHERE id = $1',
      [doc.id]
    );
    const existing = existingResult.rows[0] || null;

    let approvalDate = doc.approvalDate || existing?.approval_date || null;
    let approvalDeadline = doc.approvalDeadline || existing?.approval_deadline || null;
    let approvedStartedAt = doc.approvedStartedAt || existing?.approved_started_at || null;

    const movedIntoReview =
      incomingStage === 1 &&
      (!existing || Number(existing.stage) !== 1);

    if (movedIntoReview) {
      const now = new Date();
      approvedStartedAt = now.toISOString();
      if (!approvalDate) {
        approvalDate = addDaysToTimestamp(now, 10).toISOString();
      }
    }

    if (approvalDate) {
      approvalDeadline = approvalDate;
    }

    await pool.query(
      `
      INSERT INTO documents (
        id,
        month,
        appendix_number,
        project_name,
        counterparty,
        internal_number,
        tender_number,
        stage,
        in_mkt,
        target_year,
        comment,
        approval_date,
        approval_deadline,
        approved_started_at,
        updated_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        month = EXCLUDED.month,
        appendix_number = EXCLUDED.appendix_number,
        project_name = EXCLUDED.project_name,
        counterparty = EXCLUDED.counterparty,
        internal_number = EXCLUDED.internal_number,
        tender_number = EXCLUDED.tender_number,
        stage = EXCLUDED.stage,
        in_mkt = EXCLUDED.in_mkt,
        target_year = EXCLUDED.target_year,
        comment = EXCLUDED.comment,
        approval_date = EXCLUDED.approval_date,
        approval_deadline = EXCLUDED.approval_deadline,
        approved_started_at = EXCLUDED.approved_started_at,
        updated_at = NOW()
      `,
      [
        doc.id,
        String(doc.month),
        String(doc.appendixNumber || '').trim(),
        String(doc.projectName).trim(),
        String(doc.counterparty).trim(),
        String(doc.internalNumber || '').trim(),
        String(doc.tenderNumber || '').trim(),
        incomingStage,
        targetYearValue ? false : Boolean(doc.inMkt),
        targetYearValue,
        String(doc.comment || '').trim(),
        approvalDate,
        approvalDeadline,
        approvedStartedAt
      ]
    );

    if (doc.counterparty?.trim()) {
      await pool.query(
        `
        INSERT INTO suppliers (name)
        VALUES ($1)
        ON CONFLICT (name) DO NOTHING
        `,
        [doc.counterparty.trim()]
      );
    }

    const saved = await pool.query(
      'SELECT * FROM documents WHERE id = $1',
      [doc.id]
    );

    res.json(normalizeDoc(saved.rows[0]));
  } catch (error) {
    console.error('Save document error:', error);
    res.status(500).json({ error: 'Не удалось сохранить документ' });
  }
});

app.delete('/api/documents/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM documents WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (error) {
    console.error('Delete document error:', error);
    res.status(500).json({ error: 'Не удалось удалить документ' });
  }
});

app.get('/api/tender-decisions', async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM tender_decisions
      ORDER BY
        CASE WHEN current_stage = 'completed' THEN 1 ELSE 0 END ASC,
        stage_deadline ASC NULLS LAST,
        updated_at DESC
    `);

    res.json(result.rows.map(normalizeTenderDecision));
  } catch (error) {
    console.error('Fetch tender decisions error:', error);
    res.status(500).json({ error: 'Не удалось загрузить тендерные решения' });
  }
});

app.post('/api/tender-decisions', async (req, res) => {
  const client = await pool.connect();

  try {
    const decision = req.body || {};
    const id = String(decision.id || '').trim();
    const number = String(decision.number || '').trim();
    const title = String(decision.title || '').trim();
    const validFrom = dateOnly(decision.validFrom);
    const validTo = dateOnly(decision.validTo);
    const amount = Number(decision.amount);
    const suppliers = normalizeStringList(decision.suppliers);
    const comment = String(decision.comment || '').trim();

    if (!id || !number || !title || !validFrom || !validTo || !Number.isFinite(amount) || amount < 0) {
      return res.status(400).json({ error: 'Заполните обязательные поля тендерного решения' });
    }
    if (validFrom > validTo) {
      return res.status(400).json({ error: 'Дата окончания не может быть раньше даты начала' });
    }
    if (!suppliers.length) {
      return res.status(400).json({ error: 'Добавьте хотя бы одного поставщика' });
    }

    await client.query('BEGIN');

    const existingResult = await client.query(
      'SELECT * FROM tender_decisions WHERE id = $1 FOR UPDATE',
      [id]
    );
    const existing = existingResult.rows[0] || null;
    const allowedStages = getTenderStageKeys(amount);
    const today = todayInAppTimeZone();

    let currentStage = 'mine';
    let stageStartedOn = today;
    let stageDeadline = addDaysToDate(today, 7);
    let yuliaApproved = Boolean(decision.yuliaApproved);
    let ivanApproved = Boolean(decision.ivanApproved);

    if (existing) {
      const oldAmount = Number(existing.amount);
      const oldStage = existing.current_stage;
      const incomingStage = String(decision.currentStage || oldStage);
      const amountChanged = oldAmount !== amount;

      if (amountChanged && incomingStage === oldStage) {
        currentStage = reconcileTenderStage(oldAmount, oldStage, amount);
      } else if (incomingStage === 'completed' || allowedStages.includes(incomingStage)) {
        currentStage = incomingStage;
      } else {
        currentStage = reconcileTenderStage(oldAmount, oldStage, amount);
      }

      const stageChanged = currentStage !== oldStage;
      if (stageChanged) {
        stageStartedOn = currentStage === 'completed' ? null : today;
        stageDeadline = currentStage === 'completed' ? null : addDaysToDate(today, 7);
      } else {
        stageStartedOn = dateOnly(existing.stage_started_on) || today;
        stageDeadline = decision.stageDeadline === null
          ? dateOnly(existing.stage_deadline)
          : dateOnly(decision.stageDeadline) || dateOnly(existing.stage_deadline);
      }

      yuliaApproved = decision.yuliaApproved === undefined
        ? Boolean(existing.yulia_approved)
        : Boolean(decision.yuliaApproved);
      ivanApproved = decision.ivanApproved === undefined
        ? Boolean(existing.ivan_approved)
        : Boolean(decision.ivanApproved);
    }

    const currentIndex = allowedStages.indexOf(currentStage);
    const jointIndex = allowedStages.indexOf('yulia_ivan');
    if (currentStage === 'completed' || (jointIndex >= 0 && currentIndex > jointIndex)) {
      yuliaApproved = true;
      ivanApproved = true;
    }

    await client.query(
      `
      INSERT INTO tender_decisions (
        id,
        number,
        title,
        valid_from,
        valid_to,
        amount,
        suppliers,
        comment,
        current_stage,
        stage_started_on,
        stage_deadline,
        yulia_approved,
        ivan_approved,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
      ON CONFLICT (id) DO UPDATE SET
        number = EXCLUDED.number,
        title = EXCLUDED.title,
        valid_from = EXCLUDED.valid_from,
        valid_to = EXCLUDED.valid_to,
        amount = EXCLUDED.amount,
        suppliers = EXCLUDED.suppliers,
        comment = EXCLUDED.comment,
        current_stage = EXCLUDED.current_stage,
        stage_started_on = EXCLUDED.stage_started_on,
        stage_deadline = EXCLUDED.stage_deadline,
        yulia_approved = EXCLUDED.yulia_approved,
        ivan_approved = EXCLUDED.ivan_approved,
        updated_at = NOW()
      `,
      [
        id,
        number,
        title,
        validFrom,
        validTo,
        amount,
        suppliers,
        comment,
        currentStage,
        stageStartedOn,
        stageDeadline,
        yuliaApproved,
        ivanApproved
      ]
    );

    for (const supplier of suppliers) {
      await client.query(
        `
        INSERT INTO suppliers (name)
        VALUES ($1)
        ON CONFLICT (name) DO NOTHING
        `,
        [supplier]
      );
    }

    const saved = await client.query(
      'SELECT * FROM tender_decisions WHERE id = $1',
      [id]
    );

    await client.query('COMMIT');
    res.json(normalizeTenderDecision(saved.rows[0]));
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Save tender decision error:', error);
    res.status(500).json({ error: 'Не удалось сохранить тендерное решение' });
  } finally {
    client.release();
  }
});

app.delete('/api/tender-decisions/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM tender_decisions WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (error) {
    console.error('Delete tender decision error:', error);
    res.status(500).json({ error: 'Не удалось удалить тендерное решение' });
  }
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

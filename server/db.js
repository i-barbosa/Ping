const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true }
});

// roda no boot; cria o que falta e nao mexe no que ja existe
async function migrar() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS professores (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      nome TEXT NOT NULL,
      senha_hash TEXT NOT NULL,
      admin BOOLEAN NOT NULL DEFAULT false,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`ALTER TABLE professores ADD COLUMN IF NOT EXISTS admin BOOLEAN NOT NULL DEFAULT false`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS temas (
      id SERIAL PRIMARY KEY,
      titulo TEXT NOT NULL,
      descricao TEXT NOT NULL DEFAULT '',
      perguntas JSONB NOT NULL,
      criado_por INTEGER REFERENCES professores(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'pendente',
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`ALTER TABLE temas ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pendente'`);
  // temas antigos do banco nao tinham topico; caem em Diversos ate o professor editar e escolher um de verdade
  await pool.query(`ALTER TABLE temas ADD COLUMN IF NOT EXISTS topico TEXT NOT NULL DEFAULT 'Diversos'`);
}

async function ehAdmin(professorId) {
  if (!professorId) return false;
  const resultado = await pool.query('SELECT admin FROM professores WHERE id = $1', [professorId]);
  return resultado.rows.length > 0 && resultado.rows[0].admin === true;
}

module.exports = { pool, migrar, ehAdmin };

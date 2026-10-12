const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret';

const pool = new Pool({
    user: process.env.PGUSER || 'postgres',
    host: process.env.PGHOST || 'localhost',
    database: process.env.PGDATABASE || 'skillexchange_db',
    password: process.env.PGPASSWORD || 'your_password',
    port: Number(process.env.PGPORT || 5432),
});

// ---------- helpers / validation ----------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LEVELS = ['Beginner', 'Intermediate', 'Advanced', 'Expert'];
const TYPES = ['OFFER', 'WANT'];

const bad = (res, msg) => res.status(400).json({ error: msg });

// Auth middleware: verifies JWT (API-gateway step in the workflow)
function auth(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing token' });
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch {
        res.status(401).json({ error: 'Invalid or expired token' });
    }
}

// ==========================================
// MODULE 1: User Authentication & Profile
// ==========================================

// Register: validate -> hash password -> create USER row + empty PROFILE row (one transaction)
app.post('/api/register', async (req, res) => {
    const { name, email, password, phone, availability } = req.body;
    if (!name || name.trim().length < 2 || name.length > 100) return bad(res, 'Name must be 2-100 characters');
    if (!email || !EMAIL_RE.test(email)) return bad(res, 'Invalid email');
    if (!password || password.length < 6) return bad(res, 'Password must be at least 6 characters');
    if (phone && !/^[0-9+\- ]{6,15}$/.test(phone)) return bad(res, 'Invalid phone number');

    const client = await pool.connect();
    try {
        const hash = await bcrypt.hash(password, 10);
        await client.query('BEGIN');
        const u = await client.query(
            `INSERT INTO users (name, email, password, phone, availability)
             VALUES ($1, $2, $3, $4, $5) RETURNING user_id`,
            [name.trim(), email.toLowerCase(), hash, phone || null, availability || null]
        );
        await client.query(
            `INSERT INTO profile (user_id, availability) VALUES ($1, $2)`,
            [u.rows[0].user_id, availability || null]
        );
        await client.query('COMMIT');
        res.status(201).json({ message: 'User registered successfully', user_id: u.rows[0].user_id });
    } catch (err) {
        await client.query('ROLLBACK');
        if (err.code === '23505') return res.status(409).json({ error: 'Email already registered' });
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// Login: verify credentials against stored hash -> issue JWT
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return bad(res, 'Email and password required');
    try {
        const r = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
        const user = r.rows[0];
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const token = jwt.sign({ user_id: user.user_id, email: user.email }, JWT_SECRET, { expiresIn: '2h' });
        res.json({
            message: 'Login successful',
            token,
            user: { user_id: user.user_id, name: user.name, email: user.email }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Read own account + profile (JOIN on FK)
app.get('/api/profile', auth, async (req, res) => {
    try {
        const r = await pool.query(
            `SELECT u.user_id, u.name, u.email, u.phone, u.verification_status, u.availability,
                    p.profile_id, p.bio, p.interests, p.availability AS profile_availability
             FROM users u JOIN profile p ON p.user_id = u.user_id
             WHERE u.user_id = $1`, [req.user.user_id]);
        if (!r.rows.length) return res.status(404).json({ error: 'Profile not found' });
        res.json(r.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update own account + profile (one transaction)
app.put('/api/profile', auth, async (req, res) => {
    const { name, phone, availability, bio, interests } = req.body;
    if (!name || name.trim().length < 2 || name.length > 100) return bad(res, 'Name must be 2-100 characters');
    if (phone && !/^[0-9+\- ]{6,15}$/.test(phone)) return bad(res, 'Invalid phone number');
    if (bio && bio.length > 300) return bad(res, 'Bio max 300 characters');
    if (interests && interests.length > 100) return bad(res, 'Interests max 100 characters');

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            `UPDATE users SET name=$1, phone=$2, availability=$3 WHERE user_id=$4`,
            [name.trim(), phone || null, availability || null, req.user.user_id]);
        await client.query(
            `UPDATE profile SET bio=$1, interests=$2, availability=$3 WHERE user_id=$4`,
            [bio || null, interests || null, availability || null, req.user.user_id]);
        await client.query('COMMIT');
        res.json({ message: 'Profile updated' });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// Delete own account (cascades to profile and user_skill)
app.delete('/api/profile', auth, async (req, res) => {
    try {
        await pool.query('DELETE FROM users WHERE user_id = $1', [req.user.user_id]);
        res.json({ message: 'Account deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// MODULE 2: Skill Listing & Portfolio
// ==========================================

// Skill catalogue (for the dropdown)
app.get('/api/skills/catalogue', auth, async (req, res) => {
    try {
        const r = await pool.query('SELECT skill_id, skill_name, category FROM skill ORDER BY category, skill_name');
        res.json(r.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Add a brand new skill to the catalogue (if not listed yet)
app.post('/api/skills/catalogue', auth, async (req, res) => {
    const { skill_name, category, description } = req.body;
    if (!skill_name || skill_name.trim().length < 2 || skill_name.length > 100) return bad(res, 'Skill name must be 2-100 characters');
    try {
        const r = await pool.query(
            `INSERT INTO skill (skill_name, category, description) VALUES ($1,$2,$3) RETURNING skill_id`,
            [skill_name.trim(), category || null, description || null]);
        res.status(201).json({ message: 'Skill added to catalogue', skill_id: r.rows[0].skill_id });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'Skill already exists in catalogue' });
        res.status(500).json({ error: err.message });
    }
});

// List my skills (JOIN user_skill + skill)
app.get('/api/my-skills', auth, async (req, res) => {
    try {
        const r = await pool.query(
            `SELECT us.user_skill_id, s.skill_id, s.skill_name, s.category, us.skill_type,
                    us.experience_level, us.description, us.portfolio_link, us.preferred_timing
             FROM user_skill us JOIN skill s ON s.skill_id = us.skill_id
             WHERE us.user_id = $1
             ORDER BY us.skill_type, s.skill_name`, [req.user.user_id]);
        res.json(r.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

function validateUserSkill(b) {
    if (!TYPES.includes(b.skill_type)) return 'skill_type must be OFFER or WANT';
    if (!LEVELS.includes(b.experience_level)) return 'Invalid experience level';
    if (b.description && b.description.length > 300) return 'Description max 300 characters';
    if (b.preferred_timing && b.preferred_timing.length > 100) return 'Preferred timing max 100 characters';
    if (b.portfolio_link) {
        if (b.portfolio_link.length > 200) return 'Portfolio link max 200 characters';
        if (!/^https?:\/\/\S+$/i.test(b.portfolio_link)) return 'Portfolio link must start with http:// or https://';
    }
    return null;
}

// Add skill to my profile
app.post('/api/my-skills', auth, async (req, res) => {
    const b = req.body;
    if (!Number.isInteger(Number(b.skill_id))) return bad(res, 'skill_id required');
    const err = validateUserSkill(b);
    if (err) return bad(res, err);
    try {
        const r = await pool.query(
            `INSERT INTO user_skill (user_id, skill_id, skill_type, experience_level, description, portfolio_link, preferred_timing)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING user_skill_id`,
            [req.user.user_id, b.skill_id, b.skill_type, b.experience_level,
             b.description || null, b.portfolio_link || null, b.preferred_timing || null]);
        res.status(201).json({ message: 'Skill added', user_skill_id: r.rows[0].user_skill_id });
    } catch (e) {
        if (e.code === '23505') return res.status(409).json({ error: 'You already listed this skill with this type' });
        if (e.code === '23503') return res.status(400).json({ error: 'Skill does not exist' });
        res.status(500).json({ error: e.message });
    }
});

// Update one of my skills (ownership enforced in WHERE)
app.put('/api/my-skills/:id', auth, async (req, res) => {
    const b = req.body;
    const err = validateUserSkill(b);
    if (err) return bad(res, err);
    try {
        const r = await pool.query(
            `UPDATE user_skill SET skill_type=$1, experience_level=$2, description=$3,
                    portfolio_link=$4, preferred_timing=$5
             WHERE user_skill_id=$6 AND user_id=$7`,
            [b.skill_type, b.experience_level, b.description || null, b.portfolio_link || null,
             b.preferred_timing || null, req.params.id, req.user.user_id]);
        if (!r.rowCount) return res.status(404).json({ error: 'Skill entry not found' });
        res.json({ message: 'Skill updated' });
    } catch (e) {
        if (e.code === '23505') return res.status(409).json({ error: 'You already listed this skill with this type' });
        res.status(500).json({ error: e.message });
    }
});

// Remove one of my skills
app.delete('/api/my-skills/:id', auth, async (req, res) => {
    try {
        const r = await pool.query(
            'DELETE FROM user_skill WHERE user_skill_id=$1 AND user_id=$2',
            [req.params.id, req.user.user_id]);
        if (!r.rowCount) return res.status(404).json({ error: 'Skill entry not found' });
        res.json({ message: 'Skill removed' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const session = require('express-session');
const WebSocket = require('ws');

let mysql = null;
let bcrypt = null;
try { mysql = require('mysql2/promise'); } catch (e) { console.log('mysql2 not installed. Using local JSON database fallback.'); }
try { bcrypt = require('bcryptjs'); } catch (e) { console.log('bcryptjs not installed. Using crypto fallback.'); }

const app = express();
const PORT = process.env.PORT || 4000;
const PUBLIC_DIR = __dirname;
const DATA_FILE = path.join(PUBLIC_DIR, 'local-users.json');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET || 'mut_ict_secret_key_change_later',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

const pageFiles = ['index.html','programs.html','career.html','gallery.html','testimonials.html','contact.html','apply.html','dashboard.html','login.html','register.html'];

function stripHtml(html) {
    return html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
        .replace(/<header[\s\S]*?<\/header>/gi, ' ')
        .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim();
}
function getTitle(html, fallback) {
    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const raw = h1?.[1] || title?.[1] || fallback;
    return stripHtml(raw).replace(' - Mangosuthu University of Technology', '');
}
function loadPages() {
    return pageFiles.filter(file => fs.existsSync(path.join(PUBLIC_DIR, file))).map(file => {
        const html = fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf8');
        return { file, title: getTitle(html, file), text: stripHtml(html).toLowerCase(), displayText: stripHtml(html) };
    });
}
function scorePage(page, queryWords, phrase) {
    let score = 0;
    const title = page.title.toLowerCase();
    const file = page.file.toLowerCase();
    if (title.includes(phrase)) score += 40;
    if (file.includes(phrase)) score += 40;
    if (page.text.includes(phrase)) score += 25;
    for (const word of queryWords) {
        if (title.includes(word)) score += 12;
        if (file.includes(word)) score += 12;
        const safeWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const matches = page.text.match(new RegExp(safeWord, 'gi'));
        score += matches ? Math.min(matches.length * 3, 30) : 0;
    }
    return score;
}
function makeSnippet(text, queryWords) {
    const lower = text.toLowerCase();
    let index = -1;
    for (const word of queryWords) { index = lower.indexOf(word); if (index !== -1) break; }
    if (index === -1) index = 0;
    const start = Math.max(0, index - 80);
    const snippet = text.slice(start, start + 160).trim();
    return (start > 0 ? '...' : '') + snippet + (start + 160 < text.length ? '...' : '');
}
function searchSite(query) {
    query = query.replace(/testimonals/gi, 'testimonials').replace(/program/gi, 'programs').replace(/carrer/gi, 'career');
    const phrase = query.toLowerCase().trim();
    const queryWords = phrase.split(/\s+/).filter(word => word.length > 0);
    if (!queryWords.length) return [];
    return loadPages().map(page => ({ title: page.title, url: '/' + page.file, snippet: makeSnippet(page.displayText, queryWords), score: scorePage(page, queryWords, phrase) }))
        .filter(result => result.score > 0).sort((a,b)=>b.score-a.score).slice(0,8);
}

let pool = null;
async function initDatabase() {
    if (!mysql) return;
    try {
        pool = await mysql.createPool({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'mut_website',
            waitForConnections: true,
            connectionLimit: 10
        });
        await pool.query(`CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            fullname VARCHAR(100) NOT NULL,
            email VARCHAR(120) NOT NULL UNIQUE,
            password VARCHAR(255) NOT NULL,
            role VARCHAR(30) DEFAULT 'student',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        await pool.query(`CREATE TABLE IF NOT EXISTS chatbot_logs (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_message TEXT,
            bot_reply TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        console.log('Connected to MySQL database.');
    } catch (err) {
        pool = null;
        console.log('MySQL not connected. Using local JSON database fallback.');
        console.log('Reason:', err.message);
    }
}
function readLocalUsers() {
    if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({ users: [] }, null, 2));
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}
function writeLocalUsers(data) { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }
async function hashPassword(password) {
    if (bcrypt) return await bcrypt.hash(password, 10);
    return crypto.createHash('sha256').update(password).digest('hex');
}
async function comparePassword(password, hashed) {
    if (bcrypt) return await bcrypt.compare(password, hashed);
    return crypto.createHash('sha256').update(password).digest('hex') === hashed;
}

app.post('/api/register', async (req, res) => {
    try {
        const { fullname, email, password } = req.body;
        if (!fullname || !email || !password) return res.status(400).json({ success:false, message:'Please fill in all fields.' });
        const hashed = await hashPassword(password);
        if (pool) {
            await pool.query('INSERT INTO users(fullname,email,password) VALUES (?,?,?)', [fullname, email.toLowerCase(), hashed]);
        } else {
            const data = readLocalUsers();
            if (data.users.some(u => u.email === email.toLowerCase())) return res.status(409).json({ success:false, message:'Email already exists.' });
            data.users.push({ id: Date.now(), fullname, email: email.toLowerCase(), password: hashed, role:'student', created_at:new Date().toISOString() });
            writeLocalUsers(data);
        }
        res.json({ success:true, message:'Registration successful. You can now log in.' });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ success:false, message:'Email already exists.' });
        res.status(500).json({ success:false, message:'Registration failed.' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ success:false, message:'Enter email and password.' });
        let user;
        if (pool) {
            const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email.toLowerCase()]);
            user = rows[0];
        } else {
            user = readLocalUsers().users.find(u => u.email === email.toLowerCase());
        }
        if (!user) return res.status(401).json({ success:false, message:'User not found.' });
        const ok = await comparePassword(password, user.password);
        if (!ok) return res.status(401).json({ success:false, message:'Incorrect password.' });
        req.session.user = { id:user.id, fullname:user.fullname, email:user.email, role:user.role || 'student' };
        res.json({ success:true, message:'Login successful.', user:req.session.user });
    } catch (err) { res.status(500).json({ success:false, message:'Login failed.' }); }
});
app.get('/api/me', (req, res) => res.json({ loggedIn: !!req.session.user, user: req.session.user || null }));
app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ success:true, message:'Logged out.' })));

app.get('/api/chat', async (req, res) => {
    const message = (req.query.message || '').toLowerCase();
    let reply = "Sorry, I don't know that answer. Please contact MUT on 031 907 7111 or email info@mut.ac.za for further assistance.";
    if (message.includes('hi') || message.includes('hello') || message.includes('hey')) reply = 'Hello 👋 I am Mvelo, the MUT ICT Assistant. My name means progress, because I help students move forward with ICT information.';
    else if (message.includes('apply')) reply = 'You can apply through the MUT admissions portal or through CAO. For official help, contact 031 907 7111 or info@mut.ac.za.';
    else if (message.includes('admission') || message.includes('requirement') || message.includes('qualify')) reply = 'For ICT admission, check that you meet the required APS and subject requirements. Uploading academic records can be added as an image-processing feature. For final confirmation, contact MUT admissions.';
    else if (message.includes('course') || message.includes('program')) reply = 'The ICT Department includes programmes related to software development, networking, IT support, and information systems.';
    else if (message.includes('exam')) reply = 'Exam dates are normally shared through official MUT notices, lecturers, or student email. Please check your student email regularly.';
    else if (message.includes('contact') || message.includes('number') || message.includes('email')) reply = 'You can contact MUT at 031 907 7111 or info@mut.ac.za.';
    else if (message.includes('nsfas') || message.includes('funding')) reply = 'NSFAS funding is available for qualifying students. Visit the NSFAS website or contact MUT student support for guidance.';
    try { if (pool) await pool.query('INSERT INTO chatbot_logs(user_message, bot_reply) VALUES (?,?)', [message, reply]); } catch(e) {}
    res.json({ answer: reply });
});
app.get('/api/search', (req, res) => res.json({ query: req.query.q || '', results: searchSite(req.query.q || '') }));

// OPEN LOGIN PAGE FIRST
app.get('/', (req, res) => {
    res.redirect('/login.html');
});

app.use(express.static(PUBLIC_DIR));
app.use((req,res)=>res.status(404).send('<h1>404 - Page not found</h1><p>Go back to <a href="/index.html">Home</a>.</p>'));

initDatabase().then(() => {
    const server = app.listen(PORT, () => console.log(`MUT ICT website running at http://localhost:${PORT}`));
    const wss = new WebSocket.Server({ server });
    const notices = ['Applications for ICT programmes are now open.','NSFAS funding is available for qualifying students.','Check your student email for timetable updates.','Work Integrated Learning briefing coming soon.'];
    setInterval(() => {
        const notice = notices[Math.floor(Math.random() * notices.length)];
        wss.clients.forEach(client => { if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ notice })); });
    }, 10000);
});

import express from 'express';
import puppeteer from 'puppeteer';
import cors from 'cors';
import mysql from 'mysql2/promise';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public')); 

// --- CONFIGURAÇÃO DO BANCO DE DADOS ---
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'admin',
    database: process.env.DB_NAME || 'investidor_app',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ssl: {
        rejectUnauthorized: false
    }
});

// Testa conexão
pool.getConnection()
    .then(connection => {
        console.log('✅ Conectado ao MySQL com sucesso!');
        connection.release();
    })
    .catch(err => {
        console.error('❌ Erro ao conectar no MySQL:', err.message);
    });

// --- ROTAS DE AUTH ---
app.post('/register', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email/Senha obrigatórios.' });
    try {
        const [users] = await pool.execute('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length > 0) return res.status(409).json({ error: 'Usuário já existe.' });
        const hash = await bcrypt.hash(password, 10);
        await pool.execute('INSERT INTO users (email, password_hash) VALUES (?, ?)', [email, hash]);
        res.status(201).json({ message: 'Conta criada!' });
    } catch (error) { res.status(500).json({ error: 'Erro no servidor.' }); }
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const [users] = await pool.execute('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length === 0) return res.status(401).json({ error: 'Dados incorretos.' });
        const match = await bcrypt.compare(password, users[0].password_hash);
        if (!match) return res.status(401).json({ error: 'Dados incorretos.' });
        res.json({ message: 'Logado!', user: { id: users[0].id, email: users[0].email } });
    } catch (error) { res.status(500).json({ error: 'Erro no servidor.' }); }
});

// --- PUPPETEER INTELIGENTE ---
let browser;

async function getBrowser() {
    if (browser && !browser.isConnected()) {
        try { await browser.close(); } catch(e) {}
        browser = null;
    }

    if (!browser) {
        // Melhora a detecção: Se for Render OU Linux, usa modo otimizado
        const isRender = process.env.RENDER === 'true' || process.platform === 'linux';

        const launchConfig = {
            headless: "new",
            defaultViewport: null,
            args: []
        };

        if (isRender) {
            console.log("🚀 Modo RENDER detectado: Aplicando otimizações de memória...");
            launchConfig.args = [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu'
            ];
        } else {
            console.log("💻 Modo LOCAL detectado.");
        }

        browser = await puppeteer.launch(launchConfig);
    }
    return browser;
}

// --- HELPER FUNCTIONS ---
function strToNumber(str) {
    if (!str || typeof str !== 'string') return null;
    const cleaned = str.replace(/R\$\s?/, '').replace(/\./g, '').replace(',', '.').replace('%', '').trim();
    return isNaN(parseFloat(cleaned)) ? null : parseFloat(cleaned);
}

function createResponse(val, type='neutral') {
    return { value: val || '-', class: type };
}

// --- SCRAPING OTIMIZADO (A GRANDE MUDANÇA) ---
async function scrapeInvestidor10(browser, ticker) {
    let page;
    try {
        page = await browser.newPage();
        
        // 1. BLOQUEIO DE RECURSOS PESADOS (Imagens, CSS, Fontes)
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const type = req.resourceType();
            if (['image', 'stylesheet', 'font', 'media', 'script'].includes(type)) {
                req.abort(); // Cancela o download para economizar RAM
            } else {
                req.continue();
            }
        });

        console.log(`🔍 Buscando ${ticker}...`);
        // Timeout reduzido para falhar rápido se travar, mas domcontentloaded geralmente é rápido sem imagens
        await page.goto(`https://investidor10.com.br/acoes/${ticker.toLowerCase()}/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
        
        const data = await page.evaluate(() => {
            const getTxt = (sel) => document.querySelector(sel)?.innerText.trim() || null;
            // Ajuste para pegar do card mesmo sem CSS carregado (estrutura HTML se mantém)
            const getCard = (cls) => getTxt(`#cards-ticker ._card.${cls} ._card-body span`);
            
            const getTable = (label) => {
                const els = Array.from(document.querySelectorAll('.cell span:first-child'));
                const found = els.find(e => e.innerText.trim().toLowerCase() === label.toLowerCase());
                return found?.closest('.cell')?.querySelector('.value span')?.innerText.trim() || null;
            };

            return {
                cotacao: getCard('cotacao'),
                pl: getTable('P/L'),
                pvp: getTable('P/VP'),
                dy: getCard('dy'),
                vpa: getTable('VPA'),
                lpa: getTable('LPA'),
                roe: getTable('ROE'),
                divida: getTable('Dívida Líquida / EBITDA'),
                margem: getTable('Margem Líquida')
            };
        });
        return data;
    } catch(e) {
        console.error(`❌ Erro scraping ${ticker}:`, e.message);
        return {};
    } finally {
        if (page) await page.close();
    }
}

// --- ROTA BUSCAR ---
app.post('/buscar', async (req, res) => {
    const { ticker } = req.body;
    if (!ticker) return res.status(400).json({ error: 'Ticker vazio' });

    console.log(`Recebida busca para: ${ticker}`);

    try {
        const browser = await getBrowser();
        const i10 = await scrapeInvestidor10(browser, ticker);

        // Se não achou cotação, provavelmente a página não carregou ou ticker é inválido
        if (!i10.cotacao || i10.cotacao === '-') {
            console.log("Dados não encontrados ou incompletos.");
            return res.status(404).json({ error: 'Ativo não encontrado ou erro ao ler página.' });
        }

        // Cálculos
        const cotacao = strToNumber(i10.cotacao);
        const vpa = strToNumber(i10.vpa);
        const lpa = strToNumber(i10.lpa);
        const dy = strToNumber(i10.dy);
        
        let graham = null;
        if (vpa > 0 && lpa > 0) graham = Math.sqrt(22.5 * lpa * vpa);

        let bazin = null;
        if (dy > 0) bazin = cotacao * (dy/100) / 0.06;

        res.json({
            ticker: ticker.toUpperCase(),
            cotacao: createResponse(i10.cotacao),
            pl: createResponse(i10.pl),
            pvp: createResponse(i10.pvp),
            dy: createResponse(i10.dy),
            valorJusto: createResponse(graham ? `R$ ${graham.toFixed(2)}` : '-', graham > cotacao ? 'good' : 'neutral'),
            precoTeto: createResponse(bazin ? `R$ ${bazin.toFixed(2)}` : '-', bazin > cotacao ? 'good' : 'neutral')
        });

    } catch (error) {
        console.error("ERRO FATAL NO SERVIDOR:", error);
        // Retorna JSON mesmo no erro para o front não quebrar
        res.status(500).json({ error: 'Erro interno ao processar dados.' });
    }
});

app.post('/buscar-fii', async (req, res) => { res.json({}) }); 

process.on('SIGINT', async () => {
    if (browser) await browser.close();
    pool.end();
    process.exit(0);
});

app.listen(port, () => console.log(`Servidor rodando na porta ${port}`));
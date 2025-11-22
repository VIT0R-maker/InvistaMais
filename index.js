import puppeteer from 'puppeteer';

async function buscarVPAeLPA(ticker) {
  const url = `https://investidor10.com.br/acoes/${ticker.toLowerCase()}/`;
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(url, { waitUntil: 'domcontentloaded' });

  try {
    const dados = await page.evaluate(() => {
      const spans = Array.from(document.querySelectorAll('span'));
      let vpa = null;
      let lpa = null;

      for (let i = 0; i < spans.length; i++) {
        const texto = spans[i].innerText.toLowerCase();

        if (texto.includes('vpa') && vpa === null && spans[i + 1]) {
          vpa = spans[i + 1].innerText.trim();
        }

        if (texto.includes('lpa') && lpa === null && spans[i + 1]) {
          lpa = spans[i + 1].innerText.trim();
        }

        if (vpa && lpa) break;
      }

      return { vpa, lpa };
    });

    if (dados.vpa && dados.lpa) {
      console.log(`Ticker: ${ticker.toUpperCase()}`);
      console.log(`VPA: ${dados.vpa}`);
      console.log(`LPA: ${dados.lpa}`);
    } else {
      console.log('Não foi possível encontrar os dados.');
    }

  } catch (err) {
    console.error('Erro ao buscar os dados:', err.message);
  }

  await browser.close();
}

// Exemplo: node index.js PETR4
const ticker = process.argv[2] || 'PETR4';
buscarVPAeLPA(ticker);

import puppeteer from 'puppeteer';

export async function scrapeAcoes(ticker) {
  const url = `https://investidor10.com.br/acoes/${ticker.toLowerCase()}/`;
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();

  await page.goto(url, { waitUntil: 'domcontentloaded' });

  try {
    const dados = await page.evaluate(() => {
      const spans = Array.from(document.querySelectorAll('span'));
      let vpa = null;
      let lpa = null;

      for (let i = 0; i < spans.length; i++) {
        const texto = spans[i].innerText.toLowerCase();
        if (texto.includes('vpa') && vpa === null && spans[i + 1]) vpa = spans[i + 1].innerText.trim();
        if (texto.includes('lpa') && lpa === null && spans[i + 1]) lpa = spans[i + 1].innerText.trim();
        if (vpa && lpa) break;
      }

      return { vpa, lpa };
    });

    await browser.close();
    return dados;
  } catch (error) {
    await browser.close();
    throw new Error('Erro ao extrair os dados do site Investidor10');
  }
}

export async function scrapeFIIs(ticker) {
  const url = `https://investidor10.com.br/fiis/${ticker.toLowerCase()}/`;
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();

  await page.goto(url, { waitUntil: 'domcontentloaded' });

  try {
    const dados = await page.evaluate(() => {
      const spans = Array.from(document.querySelectorAll('span'));
      const cotacao = spans[45] ? spans[45].innerText.trim() : '-';
      const dy = spans[47] ? spans[47].innerText.trim() : '-';
      const pvp = spans[49] ? spans[49].innerText.trim() : '-';

      let ultimoRendimento = '-';
      const descSpans = Array.from(document.querySelectorAll('.desc .name'));
      for (let span of descSpans) {
        if (span.innerText.trim().toUpperCase() === 'ÚLTIMO RENDIMENTO') {
          const valueSpan = span.parentElement.querySelector('.value span');
          if (valueSpan) ultimoRendimento = valueSpan.innerText.trim();
          break;
        }
      }

      let y1m = '-';
      const y1mItems = Array.from(document.querySelectorAll('.content--info--item--title'));
      for (let item of y1mItems) {
        if (item.innerText.trim().toUpperCase() === 'YIELD 1 MÊS') {
          const valueSpan = item.parentElement.querySelector('.content--info--item--value');
          if (valueSpan) y1m = valueSpan.innerText.trim();
          break;
        }
      }

      return { cotacao, dy, pvp, ultimoRendimento, y1m };
    });

    await browser.close();

    const cotacaoNum = parseFloat(dados.cotacao.replace(/[^\d,.-]/g, '').replace(',', '.'));
    const ultimoRendimentoNum = parseFloat(dados.ultimoRendimento.replace(/[^\d,.-]/g, '').replace(',', '.'));

    let ebn = '-';
    let vn = '-';
    if (cotacaoNum > 0 && ultimoRendimentoNum > 0) {
      ebn = Math.ceil(cotacaoNum / ultimoRendimentoNum);
      vn = (ebn * cotacaoNum).toFixed(2);
    }

    return {
      ticker: ticker.toUpperCase(),
      cotacao: dados.cotacao,
      dy: dados.dy,
      pvp: dados.pvp,
      ultimoRendimento: dados.ultimoRendimento,
      y1m: dados.y1m,
      ebn: ebn,
      vn: vn
    };
  } catch (error) {
    await browser.close();
    throw new Error('Erro ao extrair os dados do site Investidor10');
  }
}

// ============================================================
// DETECÇÃO DE COMPROVATIVOS M-PESA / E-MOLA
// ============================================================

function detectarCodigo(body) {
  const mpesaMatch = body.match(/Confirmado\s+([A-Z0-9]{10,12})\.?/i);
  if (mpesaMatch) return { codigo: mpesaMatch[1], servico: 'M-PESA' };

  const emolaMatch = body.match(/(PP[A-Za-z0-9.\-]{8,})/i);
  if (emolaMatch) return { codigo: emolaMatch[1], servico: 'EMOLA' };

  return null;
}

function extrairValor(body) {
  const match = body.match(/(?:TRANSFERISTE|RECEBESTE|VALOR)[\s:]*([\d.,]+)\s*MT/i);
  if (match) return parseFloat(match[1].replace(',', '.'));
  return null;
}

module.exports = { detectarCodigo, extrairValor };

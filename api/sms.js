const { getSupabase } = require('../lib/supabase');
const { detectarCodigo, extrairValor } = require('../lib/detect');
const { requireBearer } = require('../lib/auth');

// Recebe os comprovativos encaminhados pelo monitor Termux (ver /termux).
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Método não permitido' });
    return;
  }

  if (!requireBearer(req, 'SMS_API_KEY')) {
    res.status(401).json({ message: 'Não autorizado' });
    return;
  }

  const body = req.body && req.body.body;
  if (!body || typeof body !== 'string') {
    res.status(400).json({ message: 'Campo "body" é obrigatório' });
    return;
  }

  const detectado = detectarCodigo(body);
  if (!detectado) {
    res.status(400).json({ message: 'Nenhum código de confirmação reconhecido' });
    return;
  }

  const valor = extrairValor(body);

  try {
    const supabase = getSupabase();

    const { data: existente, error: erroConsulta } = await supabase
      .from('payment_api_sms_logs')
      .select('id')
      .eq('codigo', detectado.codigo)
      .maybeSingle();

    if (erroConsulta) throw erroConsulta;

    if (existente) {
      res.status(200).json({
        success: true,
        duplicate: true,
        message: 'Comprovativo já registrado',
        codigo: detectado.codigo
      });
      return;
    }

    const { error: erroInsert } = await supabase.from('payment_api_sms_logs').insert({
      codigo: detectado.codigo,
      valor,
      servico: detectado.servico,
      body,
      device: (req.body && req.body.device) || null
    });

    if (erroInsert) throw erroInsert;

    res.status(200).json({
      success: true,
      message: 'Comprovativo recebido',
      codigo: detectado.codigo,
      valor,
      servico: detectado.servico
    });
  } catch (erro) {
    res.status(500).json({ message: 'Erro ao gravar comprovativo', erro: erro.message });
  }
};

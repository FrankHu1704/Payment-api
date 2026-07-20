const { getSupabase } = require('../lib/supabase');

module.exports = async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('payment_api_sms_logs')
      .select('servico, valor');

    if (error) throw error;

    const total = data.length;
    const mpesa = data.filter(x => x.servico === 'M-PESA').length;
    const emola = data.filter(x => x.servico === 'EMOLA').length;
    const totalValor = data.reduce((acc, x) => acc + (Number(x.valor) || 0), 0);

    res.status(200).json({ total, mpesa, emola, totalValor });
  } catch (erro) {
    res.status(500).json({ message: 'Erro ao consultar estatísticas', erro: erro.message });
  }
};

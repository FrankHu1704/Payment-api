const { getSupabase } = require('../lib/supabase');

module.exports = async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('payment_api_sms_logs')
      .select('codigo, valor, servico, received_at')
      .order('received_at', { ascending: false })
      .limit(100);

    if (error) throw error;

    const logs = data.map(row => ({
      codigo: row.codigo,
      valor: row.valor,
      servico: row.servico,
      data: row.received_at,
      status: 'sucesso'
    }));

    res.status(200).json(logs);
  } catch (erro) {
    res.status(500).json({ message: 'Erro ao consultar registros', erro: erro.message });
  }
};

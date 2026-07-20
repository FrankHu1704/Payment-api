const { getSupabase } = require('../lib/supabase');

module.exports = async (req, res) => {
  try {
    const supabase = getSupabase();
    const { error } = await supabase.from('payment_api_sms_logs').select('id').limit(1);
    if (error) throw error;
    res.status(200).json({ status: 'online' });
  } catch (erro) {
    res.status(200).json({ status: 'offline' });
  }
};

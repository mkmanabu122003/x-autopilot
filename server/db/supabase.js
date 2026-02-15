const { createClient } = require('@supabase/supabase-js');

let supabase;

function getSupabase() {
  if (!supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables are required');
    }
    supabase = createClient(url, key);
  }
  return supabase;
}

module.exports = { getSupabase };

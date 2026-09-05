/* Backend credentials.
   Fill in whichever one you are trying. Leave the other blank.
   See backend/SETUP.md for where these two values come from. */
window.FCU_BACKEND = {

  // Which driver the app should use: 'supabase' | 'appsscript' | 'local'
  // Supabase is the chosen backend. Until the two values below are filled in the
  // app falls back to 'local' so it keeps working offline.
  driver: 'supabase',

  supabase: {
    // Supabase → Project Settings → API
    url: '',        // e.g. https://abcdefghijkl.supabase.co
    anonKey: ''     // the long "anon public" key — safe to put in a web page
  },

  appsscript: {
    // Apps Script → Deploy → Web app → the /exec URL
    url: ''         // e.g. https://script.google.com/macros/s/AKfy.../exec
  }
};

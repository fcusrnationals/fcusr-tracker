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
    url: 'https://wjpsztvvuplppzswnrdx.supabase.co',
    /* The publishable key. It ships inside this page on purpose — it identifies
       the project, it does not grant anything. What a caller may actually read
       or write is decided by the row-level security policies in
       backend/supabase/schema.sql, which is why an anonymous request with this
       key gets an empty list rather than the Republic's data. */
    anonKey: 'sb_publishable_-EL0NMs6E2dk1UYLwWY7TQ_sEZAHzdI'
  },

  appsscript: {
    // Apps Script → Deploy → Web app → the /exec URL
    url: ''         // e.g. https://script.google.com/macros/s/AKfy.../exec
  }
};

// Fill these in from Supabase → Project Settings → API (the same values as the iOS app).
// Not needed with the server add-on. While they are empty (and without the add-on) the web app runs in demo mode with sample data saved in this browser.
export const CONFIG = {
  // Set automatically to true when the app is served by the CARPADS server add-on (server/), which then
  // provides logins and the database itself. Leave false here.
  useServer: false,
  supabaseUrl: "https://enkgyuyjjkliyferwhcv.supabase.co",
  supabaseAnonKey: "sb_publishable_AqJyViOCqNpeg-KFuNlPWA_dZ32vZvE", // public by design; access rules protect the data
};

export const COMPANY = {
  name: "CARPADS",
  contact: "Steve Kastrop",
  phone: "+41 78 326 48 48",
  phoneHref: "tel:+41783264848",
  email: "hello@carpads.ch",
  website: "www.carpads.ch",
  websiteHref: "https://www.carpads.ch",
};

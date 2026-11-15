# Google sign-in setup

The login and sign-up forms, and the Apply panel on a role page, use Supabase OAuth for Google. The app-side callback is `/auth/callback`. It exchanges Supabase's authorization code for a session and sends the user to the page they were heading to (the `next` path), or `/candidate/roles` when there is none.

If sign-in is cancelled or fails, the callback sends the user back to `/auth/login` with a message.

## 1. Add the app callback to Supabase

Local Supabase already allows `localhost:3000` and `127.0.0.1:3000` through `additional_redirect_urls` in `supabase/config.toml`.

For hosted Supabase, open **Dashboard > Authentication > URL Configuration**, add the production callback URL (`https://<your-domain>/auth/callback`), and set the production Site URL.

## 2. Configure Google

1. Create or select an OAuth 2.0 Client ID of type **Web application** in Google Cloud Console.
2. In its **Authorized redirect URIs**, add the Supabase Auth callback URL. Google matches it exactly (scheme, host, port, no trailing slash):
   - Local Supabase: `http://127.0.0.1:54321/auth/v1/callback`
   - Hosted Supabase: `https://<project-ref>.supabase.co/auth/v1/callback`
3. Provide the Client ID and Client Secret:
   - Local Supabase: set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in your environment (see `.env.example`). `supabase/config.toml` reads them through `env(...)`.
   - Hosted Supabase: enter them in **Authentication > Sign In / Providers > Google** and enable the provider.

## 3. Run and test locally

1. Start local Supabase: `npx supabase start`. Supabase reads `config.toml` and the environment only when it starts, so run `npx supabase stop` and `npx supabase start` again after changing either.
2. Start Next.js: `npm run dev`.
3. Open `/auth/login` or `/auth/sign-up` using the same local hostname you added to Supabase's Redirect URLs.
4. Click **Continue with Google**. You should return through `/auth/callback` and land at `/candidate/roles`.

If Google shows `redirect_uri_mismatch`, the URI in step 2 is missing from the Google client the app is using.

Provider credentials belong in Supabase provider settings or the local environment. Never commit credentials or put them in `NEXT_PUBLIC_` environment variables. The local Supabase dashboard is normally available at `http://127.0.0.1:54323`.

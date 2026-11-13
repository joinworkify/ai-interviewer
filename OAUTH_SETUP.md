# Google and LinkedIn sign-in setup

The login and sign-up forms use Supabase OAuth for Google and LinkedIn OIDC. The app-side callback is `/auth/callback`. It exchanges Supabase's authorization code for a session and sends the user to `/candidate/roles`.

## 1. Add the app callback to Supabase

In **Supabase Dashboard > Authentication > URL Configuration**, add these Redirect URLs for local development:

- `http://localhost:3000/auth/callback`
- `http://127.0.0.1:3000/auth/callback`

Set the Site URL to the local app origin you normally use (for example, `http://localhost:3000`). For production, add the production callback URL and set the production Site URL as well.

## 2. Configure Google

1. Create or select an OAuth 2.0 Client ID of type **Web application** in Google Cloud Console.
2. In its **Authorized redirect URIs**, add the Supabase Auth callback URL:
   - Local Supabase: `http://127.0.0.1:54321/auth/v1/callback`
   - Hosted Supabase: `https://<project-ref>.supabase.co/auth/v1/callback`
3. In Supabase **Authentication > Sign In / Providers > Google**, enable Google and enter the Google Client ID and Client Secret.
4. Save the provider settings.

## 3. Configure LinkedIn

1. Create an app in the LinkedIn Developer Portal and enable the **Sign In with LinkedIn using OpenID Connect** product.
2. Add the Supabase Auth callback URL as the app's authorized redirect URL:
   - Local Supabase: `http://127.0.0.1:54321/auth/v1/callback`
   - Hosted Supabase: `https://<project-ref>.supabase.co/auth/v1/callback`
3. In Supabase **Authentication > Sign In / Providers > LinkedIn (OIDC)**, enable the provider and enter the LinkedIn Client ID and Client Secret.
4. Save the provider settings.

The app uses Supabase provider ID `linkedin_oidc`, not the legacy `linkedin` provider.

## 4. Run and test locally

1. Start local Supabase: `npx supabase start`.
2. Start Next.js: `npm run dev`.
3. Open `/auth/login` or `/auth/sign-up` using the same local hostname you added to Supabase's Redirect URLs.
4. Test Google and LinkedIn separately. Each should return through `/auth/callback` and land at `/candidate/roles`.

Provider credentials belong in Supabase provider settings. Never commit credentials or put them in `NEXT_PUBLIC_` environment variables. The local Supabase dashboard is normally available at `http://127.0.0.1:54323`.

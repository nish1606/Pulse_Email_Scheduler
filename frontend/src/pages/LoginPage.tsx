import { Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

function GoogleMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303C33.654 32.657 29.196 36 24 36c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/>
      <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/>
      <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.143 35.091 26.691 36 24 36c-5.176 0-9.62-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/>
      <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/>
    </svg>
  );
}

export function LoginPage() {
  const { loading, authenticated, login } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white text-sm text-ong-muted">
        Checking session...
      </div>
    );
  }
  if (authenticated) return <Navigate to="/" replace />;

  return (
    <main className="flex min-h-screen items-center justify-center bg-white p-6">
      <div className="ong-card w-full max-w-[620px] px-8 py-10 md:min-h-[615px] md:px-[72px] md:py-12">
        <h1 className="text-center text-[44px] font-bold leading-tight text-ong-text">Login</h1>
        <button
          type="button"
          onClick={login}
          className="mt-10 flex h-[60px] w-full items-center justify-center gap-3 rounded-[12px] bg-ong-tint text-[15px] font-medium text-ong-text transition hover:bg-[#d9eee3] focus:outline-none focus:ring-2 focus:ring-ong-primary/20"
          aria-label="Login with Google"
        >
          <GoogleMark />
          <span>Login with Google</span>
        </button>

        <div className="my-7 flex items-center gap-4" aria-hidden="true">
          <div className="h-px flex-1 bg-ong-border" />
          <span className="text-[13px] tracking-wide text-ong-muted">or sign up through email</span>
          <div className="h-px flex-1 bg-ong-border" />
        </div>

        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); login(); }} aria-label="Email login (uses Google OAuth)">
          <label className="block">
            <span className="sr-only">Email ID</span>
            <input type="email" name="email" autoComplete="username" placeholder="Email ID" className="ong-input-lg" />
          </label>
          <label className="block">
            <span className="sr-only">Password</span>
            <input type="password" name="password" autoComplete="current-password" placeholder="Password" className="ong-input-lg" />
          </label>
          <button type="submit" className="ong-btn-green mt-2 w-full">Login</button>
        </form>
        <p className="mt-4 text-center text-xs text-ong-muted">
          Sign-in uses Google OAuth via the backend. Email/password fields are shown for the reference layout.
        </p>
      </div>
    </main>
  );
}

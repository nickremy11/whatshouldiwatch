import { useEffect, useRef, useState } from "react";
import { Navigate, useSearchParams } from "react-router";
import { useConfig } from "../api";
import { Spinner } from "../components/ui";

declare global {
	interface Window {
		turnstile?: {
			render: (el: HTMLElement, opts: { sitekey: string; theme?: string; callback: (token: string) => void; "expired-callback"?: () => void }) => string;
			remove: (id: string) => void;
		};
	}
}

const ERRORS: Record<string, string> = {
	turnstile: "The bot check didn't pass. Please try again.",
	config: "Google sign-in isn't configured yet.",
	denied: "Sign-in was cancelled.",
	state: "Your sign-in session expired. Please try again.",
	google: "Google sign-in failed. Please try again.",
	blocked: "This account has been disabled.",
};

function loadTurnstile(): Promise<void> {
	if (window.turnstile) return Promise.resolve();
	return new Promise((resolve, reject) => {
		const existing = document.querySelector<HTMLScriptElement>("script[data-turnstile]");
		const s = existing ?? document.createElement("script");
		s.addEventListener("load", () => resolve());
		s.addEventListener("error", () => reject(new Error("Turnstile failed to load")));
		if (!existing) {
			s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
			s.async = true;
			s.dataset.turnstile = "1";
			document.head.appendChild(s);
		}
	});
}

export function LoginPage() {
	const config = useConfig();
	const [params] = useSearchParams();
	const returnTo = params.get("returnTo") ?? "/";
	const error = params.get("error");
	const widget = useRef<HTMLDivElement>(null);
	const [token, setToken] = useState("");

	const siteKey = config.data?.turnstileSiteKey;
	useEffect(() => {
		if (!siteKey || !widget.current) return;
		let id: string | undefined;
		let cancelled = false;
		loadTurnstile()
			.then(() => {
				if (cancelled || !widget.current || !window.turnstile) return;
				id = window.turnstile.render(widget.current, {
					sitekey: siteKey,
					theme: "dark",
					callback: setToken,
					"expired-callback": () => setToken(""),
				});
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
			if (id) window.turnstile?.remove(id);
		};
	}, [siteKey]);

	if (config.isLoading) return <Spinner />;
	if (config.data?.me) return <Navigate to={returnTo} replace />;

	return (
		<div className="mx-auto max-w-sm space-y-6 py-10 text-center">
			<div>
				<h1 className="text-2xl font-bold">Sign in</h1>
				<p className="mt-1 text-sm text-muted">Track what you've watched, rate titles and get personal recommendations. New here? Signing in creates your account.</p>
			</div>
			{error ? <p className="rounded-lg bg-red-500/10 p-3 text-sm text-red-200">{ERRORS[error] ?? "Sign-in failed."}</p> : null}
			{/* A real form POST so the server can verify Turnstile and redirect to Google. */}
			<form method="post" action="/auth/google/start" className="space-y-4">
				<input type="hidden" name="returnTo" value={returnTo} />
				<input type="hidden" name="cf-turnstile-response" value={token} />
				<div ref={widget} className="flex min-h-16 justify-center" />
				<button type="submit" className="btn w-full bg-white py-3 text-gray-900 hover:bg-gray-100" disabled={!token}>
					<svg viewBox="0 0 48 48" className="size-5" aria-hidden="true">
						<path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
						<path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
						<path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
						<path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
					</svg>
					Continue with Google
				</button>
			</form>
		</div>
	);
}

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { ApiError } from "./api";
import { Layout } from "./components/Layout";
import "./index.css";
import { DiscoverPage } from "./pages/Discover";
import { HomePage } from "./pages/Home";
import { ListsPage } from "./pages/Lists";
import { LoginPage } from "./pages/Login";
import { PersonPage } from "./pages/Person";
import { PicksPage } from "./pages/Picks";
import { SearchPage } from "./pages/Search";
import { SettingsPage } from "./pages/Settings";
import { TitlePage } from "./pages/Title";

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 60_000,
			refetchOnWindowFocus: false,
			retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
		},
	},
});

const router = createBrowserRouter([
	{
		element: <Layout />,
		children: [
			{ path: "/", element: <HomePage /> },
			{ path: "/search", element: <SearchPage /> },
			{ path: "/discover", element: <DiscoverPage /> },
			{ path: "/title/:type/:id", element: <TitlePage /> },
			{ path: "/person/:id", element: <PersonPage /> },
			{ path: "/picks", element: <PicksPage /> },
			{ path: "/lists", element: <ListsPage /> },
			{ path: "/settings", element: <SettingsPage /> },
			{ path: "/login", element: <LoginPage /> },
			{ path: "*", element: <p className="text-muted">Page not found.</p> },
		],
	},
]);

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
		</QueryClientProvider>
	</StrictMode>,
);

import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import type { TitleCard } from "../../shared/types";
import { api, img, qs, usePrefs } from "../api";
import { ErrorBox, Spinner, TitleGrid } from "../components/ui";

interface PersonResponse {
	id: number;
	name: string;
	biography: string;
	profilePath: string | null;
	birthday: string | null;
	department: string;
	credits: TitleCard[];
}

export function PersonPage() {
	const id = Number(useParams().id);
	const { region } = usePrefs();
	const person = useQuery({ queryKey: ["person", id], queryFn: () => api<PersonResponse>(`/people/${id}${qs({ region })}`) });
	if (person.isLoading) return <Spinner />;
	if (person.error) return <ErrorBox error={person.error} />;
	const p = person.data!;
	return (
		<div className="space-y-8">
			<div className="flex flex-col gap-6 sm:flex-row">
				{img(p.profilePath, "w342") ? <img src={img(p.profilePath, "w342")!} alt="" className="w-40 rounded-xl" /> : null}
				<div className="space-y-3">
					<h1 className="text-3xl font-bold">{p.name}</h1>
					<p className="text-sm text-muted">
						{p.department}
						{p.birthday ? ` · Born ${new Date(`${p.birthday}T00:00:00`).toLocaleDateString()}` : ""}
					</p>
					<p className="line-clamp-6 max-w-3xl text-sm leading-relaxed text-gray-300">{p.biography}</p>
					<div className="flex gap-2">
						<Link className="btn btn-primary" to={`/discover?type=movie&person=${p.id}&personName=${encodeURIComponent(p.name)}`}>
							Filter movies with {p.name.split(" ")[0]}
						</Link>
						<Link className="btn" to={`/discover?type=tv&person=${p.id}&personName=${encodeURIComponent(p.name)}`}>
							Filter shows
						</Link>
					</div>
				</div>
			</div>
			<section className="space-y-3">
				<h2 className="text-lg font-semibold">Known for</h2>
				<TitleGrid items={p.credits} />
			</section>
		</div>
	);
}

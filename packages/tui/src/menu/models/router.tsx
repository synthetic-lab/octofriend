import type React from "react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useLatestInput, useLatestRef } from "../../input/latest-input";

export type Route<
	TRoutes extends { [TRouteKey in keyof TRoutes]: object },
	TKey extends keyof TRoutes,
> = (router: ToRoute<TRoutes>) => React.FC<TRoutes[TKey]>;

export type ToRoute<TRoutes extends { [TRouteKey in keyof TRoutes]: object }> =
	{
		[TKey in keyof TRoutes]: (props: TRoutes[TKey]) => void;
	};

type RouterComponents<
	TRoutes extends { [TRouteKey in keyof TRoutes]: object },
> = {
	[TKey in keyof TRoutes]: Route<TRoutes, TKey>;
};

export function router<
	TRoutes extends { [TRouteKey in keyof TRoutes]: object },
>() {
	return {
		build: <TKey extends keyof TRoutes>(
			_: TKey,
			route: Route<TRoutes, TKey>,
		) => {
			return route;
		},
		withRoutes<TKey extends keyof TRoutes>(..._: TKey[]) {
			type Filtered = {
				[TFilteredKey in TKey]: TRoutes[TFilteredKey];
			};
			return {
				build: <TFilteredKey extends keyof Filtered>(
					_: TFilteredKey,
					route: Route<Filtered, TFilteredKey>,
				) => {
					return route;
				},
			};
		},
		route: (componentBuilders: RouterComponents<TRoutes>) => {
			return new RouteBuilder<TRoutes>(componentBuilders);
		},
	};
}

export function Back({
	go,
	children,
}: {
	go: () => void;
	children: React.ReactNode;
}) {
	const goRef = useLatestRef(go);
	useLatestInput(
		useCallback((_, key) => {
			if (key.escape) goRef.current();
		}, []),
	);
	return <>{children}</>;
}

type RouteState<TRoutes extends { [TRouteKey in keyof TRoutes]: object }> = {
	route: keyof TRoutes;
	props: TRoutes[keyof TRoutes];
};

function shallowRoutePropsEqual(left: object, right: object): boolean {
	if (left === right) return true;
	const leftRecord = left as Record<string, unknown>;
	const rightRecord = right as Record<string, unknown>;
	let leftKeyCount = 0;
	let rightKeyCount = 0;
	for (const key in left) {
		if (!Object.hasOwn(left, key)) continue;
		leftKeyCount += 1;
		if (!Object.hasOwn(right, key)) return false;
		if (!Object.is(leftRecord[key], rightRecord[key])) return false;
	}
	for (const key in right) {
		if (Object.hasOwn(right, key)) rightKeyCount += 1;
	}
	return leftKeyCount === rightKeyCount;
}

function routeStateMatchesInitial<
	TRoutes extends { [TRouteKey in keyof TRoutes]: object },
	TInitial extends keyof TRoutes,
>(
	state: RouteState<TRoutes>,
	initial: { route: TInitial; props: TRoutes[TInitial] },
): boolean {
	return (
		state.route === initial.route &&
		shallowRoutePropsEqual(state.props, initial.props)
	);
}

function routeStateEqual<
	TRoutes extends { [TRouteKey in keyof TRoutes]: object },
>(left: RouteState<TRoutes>, right: RouteState<TRoutes>): boolean {
	return (
		left.route === right.route &&
		shallowRoutePropsEqual(left.props, right.props)
	);
}

export class RouteBuilder<
	TRoutes extends { [TRouteKey in keyof TRoutes]: object },
> {
	Root: <TInitial extends keyof TRoutes>(initial: {
		route: TInitial;
		props: TRoutes[TInitial];
	}) => React.ReactNode;

	constructor(componentBuilders: RouterComponents<TRoutes>) {
		this.Root = <TInitial extends keyof TRoutes>(initial: {
			route: TInitial;
			props: TRoutes[TInitial];
		}) => {
			const router = useMemo(() => {
				return new TerminalModelSetupRouter(initial);
			}, []);
			const initialRoute = initial.route;
			const initialProps = initial.props;
			const initialStateRef = useRef<RouteState<TRoutes>>(router.current());
			const [current, setCurrent] = useState(router.current());
			const initialChanged = !routeStateMatchesInitial(
				initialStateRef.current,
				initial,
			);
			const renderedCurrent = initialChanged
				? ({ route: initialRoute, props: initialProps } as RouteState<TRoutes>)
				: current;

			const Current = useMemo(() => {
				const minirouter: Partial<ToRoute<TRoutes>> = {};
				for (const routeKey in componentBuilders) {
					if (!Object.hasOwn(componentBuilders, routeKey)) continue;
					const key = routeKey as keyof TRoutes;
					minirouter[key] = (props: TRoutes[typeof key]) => {
						router.route({
							from: renderedCurrent.route,
							to: key,
							props,
						});
					};
				}
				const builder = componentBuilders[renderedCurrent.route];
				return builder(minirouter as ToRoute<TRoutes>);
			}, [componentBuilders, renderedCurrent, router]);

			useLayoutEffect(() => {
				if (!routeStateMatchesInitial(initialStateRef.current, initial)) {
					const nextInitial = { route: initialRoute, props: initialProps };
					initialStateRef.current = nextInitial as RouteState<TRoutes>;
					router.reset(nextInitial);
					setCurrent(router.current());
				}
			}, [initial, initialProps, initialRoute, router]);

			useEffect(() => {
				const listener = <TKey extends keyof TRoutes>(
					route: TKey,
					props: TRoutes[TKey],
				) => {
					setCurrent((previous) => {
						if (
							previous.route === route &&
							shallowRoutePropsEqual(previous.props, props)
						) {
							return previous;
						}
						return { route, props };
					});
				};
				router.addRouteListener(listener);
				setCurrent((previous) => {
					const latest = router.current();
					if (routeStateEqual(previous, latest)) return previous;
					return latest;
				});
				return () => router.removeRouteListener(listener);
			}, [router]);

			return <Current {...renderedCurrent.props} />;
		};
	}
}

class TerminalModelSetupRouter<
	TRoutes extends { [TRouteKey in keyof TRoutes]: object },
	TInitial extends keyof TRoutes,
> {
	#current: RouteState<TRoutes>;
	#routeChangeCallbacks: Array<
		<TKey extends keyof TRoutes>(route: TKey, data: TRoutes[TKey]) => void
	> = [];

	constructor(initial: { route: TInitial; props: TRoutes[TInitial] }) {
		this.#current = initial;
	}

	current(): RouteState<TRoutes> {
		return this.#current;
	}

	reset<TKey extends keyof TRoutes>(initial: {
		route: TKey;
		props: TRoutes[TKey];
	}) {
		this.#current = initial;
		this.#onRouteChange(initial.route, initial.props);
	}

	route<TKey extends keyof TRoutes>({
		from,
		to,
		props,
	}: {
		from: keyof TRoutes;
		to: TKey;
		props: TRoutes[TKey];
	}) {
		if (this.#current.route === from) {
			if (
				this.#current.route === to &&
				shallowRoutePropsEqual(this.#current.props, props)
			) {
				return;
			}
			this.#current = { route: to, props };
			this.#onRouteChange(to, props);
		}
	}

	addRouteListener(
		listener: <TKey extends keyof TRoutes>(
			route: TKey,
			props: TRoutes[TKey],
		) => void,
	) {
		this.#routeChangeCallbacks.push(listener);
		return listener;
	}

	removeRouteListener(
		listener: <TKey extends keyof TRoutes>(
			route: TKey,
			props: TRoutes[TKey],
		) => void,
	) {
		const index = this.#routeChangeCallbacks.indexOf(listener);
		if (index >= 0) this.#routeChangeCallbacks.splice(index, 1);
	}

	#onRouteChange<TKey extends keyof TRoutes>(
		route: TKey,
		props: TRoutes[TKey],
	) {
		for (const callback of this.#routeChangeCallbacks) {
			callback(route, props);
		}
	}
}

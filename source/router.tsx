import React, { useState, useEffect, useMemo } from "react";
import { useInput } from "ink";

export type Route<
  T extends Record<string, any>,
  K extends keyof T
> = (router: ToRoute<T>) => React.FC<T[K]>;

export function router<T extends Record<string, any>>() {
  return {
    build: <K extends keyof T>(_: K, route: Route<T, K>) => {
      return route;
    },
    withRoutes<K extends keyof T>(..._: K[]) {
      type Filtered = {
        [K2 in K]: T[K2]
      };
      return {
        build: <K extends keyof Filtered>(_: K, route: Route<Filtered, K>) => {
          return route;
        },
      };
    },
    route: (componentBuilders: RouterComponents<T>) => {
      return new RouteBuilder<T>(componentBuilders);
    },
  };
}

type RouterComponents<T extends Record<string, any>> = {
  [K in keyof T]: Route<T, K>
};

export function Back({ go, children }: { go: () => any, children: React.ReactNode }) {
  useInput((_, key) => {
    if(key.escape) go();
  });
  return children;
}

export class RouteBuilder<T extends Record<string, any>> {
  Root: <Initial extends keyof T>(initial: { route: Initial, props: T[Initial] }) => React.ReactNode;
  constructor(
    componentBuilders: RouterComponents<T>
  ) {
    this.Root = <Initial extends keyof T>(initial: { route: Initial, props: T[Initial] }) => {
      const router = useMemo(() => {
        return new Router(initial);
      }, []);

      const [ current, setCurrent ] = useState(router.current());

      const Current = useMemo(() => {
        const minirouter: Partial<ToRoute<T>> = {};
        for(const key of Object.keys(componentBuilders)) {
          // @ts-ignore
          minirouter[key] = props => {
            router.route({
              from: current.route,
              to: key,
              props,
            });
          };
        }
        const builder = componentBuilders[current.route];
        return builder(minirouter as ToRoute<T>);
      }, [ current ]);

      useEffect(() => {
        const listener = router.addRouteListener((route, props) => {
          setCurrent({ route, props });
        });
        setCurrent(router.current());
        return () => router.removeRouteListener(listener);
      }, [ router ]);

      return <Current {...current.props } />
    };
  }
}

export type ToRoute<T extends Record<string, any>> = {
  [K in keyof T]: (props: T[K]) => void
};

class Router<T extends Record<string, any>, Initial extends keyof T> {
  private _current: {
    route: keyof T,
    props: T[keyof T],
  };
  private _routeChangeCallbacks: Array<
    <K extends keyof T>(route: K, data: T[K]) => any
  > = [];

  constructor(
    initial: {
      route: Initial,
      props: T[Initial],
    },
  ) {
    this._current = initial;
  }

  current() {
    return { ...this._current };
  }

  route<K extends keyof T>({ from, to, props }: {
    from: keyof T,
    to: K,
    props: T[K],
  }) {
    if(this._current.route === from) {
      this._current = { route: to, props };
      this.onRouteChange(to, props);
    }
  }

  addRouteListener(listener: <K extends keyof T>(route: K, props: T[K]) => any) {
    this._routeChangeCallbacks.push(listener);
    return listener;
  }

  removeRouteListener(listener: <K extends keyof T>(route: K, props: T[K]) => any) {
    const index = this._routeChangeCallbacks.indexOf(listener);
    if(index >= 0) this._routeChangeCallbacks.splice(index, 1);
  }

  private onRouteChange<K extends keyof T>(route: K, props: T[K]) {
    for(const cb of this._routeChangeCallbacks) {
      cb(route, props);
    }
  }
}

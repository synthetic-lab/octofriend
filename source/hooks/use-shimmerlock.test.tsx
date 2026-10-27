import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, describe, expect, it } from "bun:test";
import { useShimmerlock, useShimmerlockOwnershipCheck } from "./use-shimmerlock.ts";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

type ContenderProps = {
  name: string;
  running?: boolean;
};

function Contender(props: ContenderProps) {
  const lock = useShimmerlock("explore-subagent");
  return <OwnershipCheck {...props} lock={lock} />;
}

function OwnershipCheck({ name, running = true, lock }: ContenderProps & { lock: symbol }) {
  const ownsLock = useShimmerlockOwnershipCheck(lock);
  return <span>{`${name}:${ownsLock}:${running && ownsLock}`}</span>;
}

function Harness({ contenders }: { contenders: Array<ContenderProps> }) {
  return contenders.map(contender => <Contender key={contender.name} {...contender} />);
}

let renderer: TestRenderer.ReactTestRenderer | undefined;

function render(contenders: Array<ContenderProps>) {
  act(() => {
    if (renderer == null) {
      renderer = TestRenderer.create(<Harness contenders={contenders} />);
    } else {
      renderer.update(<Harness contenders={contenders} />);
    }
  });
}

function statuses(): string[] {
  return renderer!.root.findAllByType("span").map(node => node.children.join(""));
}

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

describe("useShimmerlock", () => {
  it("gives the most recently mounted contender ownership among equal priorities", () => {
    render([{ name: "a" }]);
    expect(statuses()).toEqual(["a:true:true"]);

    render([{ name: "a" }, { name: "b" }]);
    expect(statuses()).toEqual(["a:false:false", "b:true:true"]);
  });

  it("handles out-of-order unmounts without losing ownership or reusing registrations", () => {
    render([{ name: "a" }, { name: "b" }, { name: "c" }]);
    expect(statuses()).toEqual(["a:false:false", "b:false:false", "c:true:true"]);

    render([{ name: "a" }, { name: "c" }]);
    expect(statuses()).toEqual(["a:false:false", "c:true:true"]);

    render([{ name: "a" }, { name: "c" }, { name: "d" }]);
    expect(statuses()).toEqual(["a:false:false", "c:false:false", "d:true:true"]);

    render([{ name: "a" }, { name: "c" }]);
    expect(statuses()).toEqual(["a:false:false", "c:true:true"]);

    render([{ name: "a" }]);
    expect(statuses()).toEqual(["a:true:true"]);
  });

  it("retains ownership while idle without letting another contender shimmer", () => {
    render([{ name: "a" }, { name: "b", running: false }]);
    expect(statuses()).toEqual(["a:false:false", "b:true:false"]);

    render([{ name: "a", running: false }, { name: "b" }]);
    expect(statuses()).toEqual(["a:false:false", "b:true:true"]);

    render([{ name: "a" }, { name: "b", running: false }]);
    expect(statuses()).toEqual(["a:false:false", "b:true:false"]);
  });

  it("does not change registration order on rerenders or keyed reordering", () => {
    render([{ name: "a" }, { name: "b" }]);
    render([{ name: "b" }, { name: "a" }]);
    expect(statuses()).toEqual(["b:true:true", "a:false:false"]);
  });

  it("lets multiple children share ownership without registering individually", () => {
    function SharedContender({ showDetail }: { showDetail: boolean }) {
      const lock = useShimmerlock("explore-subagent");
      return (
        <>
          <OwnershipCheck name="name" lock={lock} />
          {showDetail && <OwnershipCheck name="detail" lock={lock} />}
        </>
      );
    }

    act(() => {
      renderer = TestRenderer.create(
        <>
          <SharedContender showDetail={false} />
          <Contender name="other" />
        </>,
      );
    });
    expect(statuses()).toEqual(["name:false:false", "other:true:true"]);

    act(() => {
      renderer!.update(
        <>
          <SharedContender showDetail />
          <Contender name="other" />
        </>,
      );
    });
    expect(statuses()).toEqual(["name:false:false", "detail:false:false", "other:true:true"]);

    act(() => {
      renderer!.update(
        <>
          <SharedContender showDetail />
        </>,
      );
    });
    expect(statuses()).toEqual(["name:true:true", "detail:true:true"]);
  });

  it("cleans up registrations during StrictMode effect replay", () => {
    act(() => {
      renderer = TestRenderer.create(
        <React.StrictMode>
          <Harness contenders={[{ name: "a" }, { name: "b" }]} />
        </React.StrictMode>,
      );
    });
    expect(statuses()).toEqual(["a:false:false", "b:true:true"]);

    act(() => {
      renderer!.update(
        <React.StrictMode>
          <Harness contenders={[{ name: "a" }]} />
        </React.StrictMode>,
      );
    });
    expect(statuses()).toEqual(["a:true:true"]);
  });
});

import React, { useState, useEffect } from "react";
import spinners from "cli-spinners";
import type { SpinnerName } from "cli-spinners";
import { Span } from "paintcannon-react";
type Props = {
  /**
   * Type of a spinner.
   * See [cli-spinners](https://github.com/sindresorhus/cli-spinners) for available spinners.
   *
   * @default dots
   */
  type?: SpinnerName;
};

/**
 * Spinner.
 */
function Spinner({ type = "dots" }: Props) {
  const [frame, setFrame] = useState(0);
  const spinner = spinners[type];
  useEffect(() => {
    const timer = setInterval(() => {
      setFrame(previousFrame => {
        const isLastFrame = previousFrame === spinner.frames.length - 1;
        return isLastFrame ? 0 : previousFrame + 1;
      });
    }, spinner.interval);
    return () => {
      clearInterval(timer);
    };
  }, [spinner]);
  return <Span>{spinner.frames[frame]}</Span>;
}
export default React.memo(Spinner);

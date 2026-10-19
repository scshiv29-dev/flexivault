import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

const ClockContext = createContext<number>(Date.now());

/**
 * Single shared 1-second clock. Every TOTP ring and countdown reads from this
 * so a vault with 100 codes still only runs one timer.
 */
export function ClockProvider({ children }: { children: ReactNode }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const tick = () => {
      const current = Date.now();
      setNow(current);
      timer = setTimeout(tick, 1000 - (current % 1000));
    };

    timer = setTimeout(tick, 1000 - (Date.now() % 1000));
    return () => clearTimeout(timer);
  }, []);

  return <ClockContext.Provider value={now}>{children}</ClockContext.Provider>;
}

export function useClock(): number {
  return useContext(ClockContext);
}
